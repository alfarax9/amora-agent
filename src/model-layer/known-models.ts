import { refuseSecrets, type Storage } from "../runtime/storage.ts";
import { dayMs } from "../runtime/time.ts";
import type { ModelCapabilities, Registry, StructuredOutput } from "./registry.ts";

export type ProbeResult = {
  capability: keyof ModelCapabilities;
  result: string;
  detail: string;
};

export type CapabilityLookup = (model: string) => ModelCapabilities | undefined;

export function saveProbeResults(
  storage: Storage,
  model: string,
  results: ProbeResult[],
  probedAt: Date = new Date(),
): void {
  // Scanned up front, so a refused row cannot leave the others half written.
  for (const { capability, result, detail } of results) {
    refuseSecrets(`${model} ${capability} ${result} ${detail}`, "probe results");
  }
  const insert = storage.database.prepare(
    `INSERT INTO model_probes (model, capability, result, detail, probed_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (model, capability) DO UPDATE SET
       result = excluded.result, detail = excluded.detail, probed_at = excluded.probed_at`,
  );
  for (const { capability, result, detail } of results) {
    insert.run(model, capability, result, detail, probedAt.toISOString());
  }
}

type Probed = { capabilities: ModelCapabilities; probedAt: string };

function memberCapabilities(storage: Storage, model: string): Probed | undefined {
  const rows = storage.database
    .prepare("SELECT capability, result, probed_at FROM model_probes WHERE model = ?")
    .all(model) as { capability: string; result: string; probed_at: string }[];
  const value = Object.fromEntries(rows.map((row) => [row.capability, row.result]));
  // A half-probed model (a run that stopped partway) counts as unknown.
  if (!["vision", "tool_use", "structured_output", "context"].every((key) => key in value)) {
    return undefined;
  }
  const capabilities: ModelCapabilities = {
    vision: value.vision === "true",
    tool_use: value.tool_use === "true",
    structured_output: value.structured_output as StructuredOutput,
    context: Number(value.context),
  };
  const probedAt = rows.map((row) => row.probed_at).sort()[0] ?? "";
  return { capabilities, probedAt };
}

// A combo as AMORA last read it: its members, by full model id, and the
// gateway's own figure for its context length.
export type ComboRecord = { members: string[]; contextLength: number | null; strategy: string };

export function saveCombo(storage: Storage, id: string, combo: ComboRecord): void {
  const combos = storage.getSetting<Record<string, ComboRecord>>("combos") ?? {};
  storage.setSetting("combos", { ...combos, [id]: combo });
}

export function comboOf(storage: Storage, id: string): ComboRecord | undefined {
  return storage.getSetting<Record<string, ComboRecord>>("combos")?.[id];
}

const strength: Record<StructuredOutput, number> = { none: 0, json_mode: 1, json_schema: 2 };

// A combo can fall back to any of its members, so it can only do what every
// member can do. One member that was never probed makes the whole combo
// unknown, so a worker never gets a combo on the strength of part of it.
function comboCapabilities(storage: Storage, combo: ComboRecord): Probed | undefined {
  const measured = combo.members.map((member) => memberCapabilities(storage, member));
  const members = measured.filter((member): member is Probed => member !== undefined);
  if (members.length === 0 || members.length < measured.length) return undefined;
  const all = members.map((member) => member.capabilities);
  const weakest = all.reduce((low, next) =>
    strength[next.structured_output] < strength[low.structured_output] ? next : low,
  );
  const capabilities: ModelCapabilities = {
    vision: all.every((member) => member.vision),
    tool_use: all.every((member) => member.tool_use),
    structured_output: weakest.structured_output,
    context: combo.contextLength ?? Math.min(...all.map((member) => member.context)),
  };
  return { capabilities, probedAt: members.map((member) => member.probedAt).sort()[0] ?? "" };
}

export function probedCapabilities(storage: Storage, model: string): Probed | undefined {
  const combo = comboOf(storage, model);
  return combo ? comboCapabilities(storage, combo) : memberCapabilities(storage, model);
}

// The user's own probes win over the registry: they were measured on the
// user's account and providers, and they are newer.
export function capabilityLookup(storage: Storage, registry: Registry): CapabilityLookup {
  return (model) =>
    probedCapabilities(storage, model)?.capabilities ??
    registry.models.find((entry) => entry.model === model)?.capabilities;
}

export const probeMaxAgeDays = 7;

// Providers change what they serve under a model's name, so a measurement ages.
// Only models this machine has probed can be stale; one that was never probed
// is "unprobed", which is a different problem with a different fix.
export function staleProbes(
  storage: Storage,
  models: string[],
  now: number = Date.now(),
): string[] {
  return models.filter((model) => {
    const probed = probedCapabilities(storage, model);
    return probed !== undefined && now - Date.parse(probed.probedAt) > probeMaxAgeDays * dayMs;
  });
}
