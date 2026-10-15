import type { Storage } from "../runtime/storage.ts";
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
  const insert = storage.database.prepare(
    `INSERT INTO model_probes (model, capability, result, detail, probed_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (model, capability) DO UPDATE SET
       result = excluded.result, detail = excluded.detail, probed_at = excluded.probed_at`,
  );
  for (const { capability, result, detail } of results) {
    insert.run(model, capability, result, detail, probedAt.toISOString());
  }
}

export function probedCapabilities(
  storage: Storage,
  model: string,
): { capabilities: ModelCapabilities; probedAt: string } | undefined {
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

// The user's own probes win over the registry: they were measured on the
// user's account and providers, and they are newer.
export function capabilityLookup(storage: Storage, registry: Registry): CapabilityLookup {
  return (model) =>
    probedCapabilities(storage, model)?.capabilities ??
    registry.models.find((entry) => entry.model === model)?.capabilities;
}
