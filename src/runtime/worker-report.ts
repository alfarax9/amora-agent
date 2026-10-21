import { familyLookup } from "../model-layer/families.ts";
import { capabilityLookup } from "../model-layer/known-models.ts";
import type { ModelCapabilities } from "../model-layer/registry.ts";
import { emptySlots, resolveWorker, type SlotConfig } from "../model-layer/slots.ts";
import { divisions, type WorkerManifest } from "./manifest-schema.ts";
import type { ReportDesk } from "./report-routes.ts";
import type { Storage } from "./storage.ts";

// The Workers page: every loaded worker by division, the model its slot
// resolves to (worker, then division, then global, as slots.ts resolves it),
// each requirement checked against that model, and its latest handoffs.

// The dashboard PRD's requirement codes. `met` is null when nothing is known
// yet: no model, or a model that was never probed.
type Check = { code: string; name: string; met: boolean | null; detail?: string };

function capabilityChecks(manifest: WorkerManifest, known?: ModelCapabilities): Check[] {
  const { requires } = manifest;
  const met = (test: (capabilities: ModelCapabilities) => boolean) => (known ? test(known) : null);
  const checks: Check[] = [];
  if (requires.vision) checks.push({ code: "V", name: "Vision", met: met((c) => c.vision) });
  if (requires.tool_use) checks.push({ code: "T", name: "Tool use", met: met((c) => c.tool_use) });
  if (requires.structured_output) {
    const strict = met((c) => c.structured_output === "json_schema");
    checks.push({ code: "S", name: "Strict JSON schema", met: strict });
  }
  if (requires.min_context > 0) {
    const name = `Context of ${requires.min_context.toLocaleString("en-US")} tokens`;
    checks.push({ code: "LC", name, met: met((c) => c.context >= requires.min_context) });
  }
  return checks;
}

// The different-family rule is checked against the work each review covers,
// so here it can only say whether the family is known; an unknown one blocks
// the review (families.ts).
function familyCheck(families: string[] | undefined): Check {
  const name = "Different model family from the work it reviews";
  if (!families) return { code: "≠", name, met: false, detail: "The model's family is unknown." };
  return {
    code: "≠",
    name,
    met: null,
    detail: `Checked at each review; family ${families.join(", ")}.`,
  };
}

type HandoffRow = {
  task_id: string;
  brief: string;
  receiver: string;
  contract: string;
  validation: string;
  gate: string;
  gate_reason: string;
  model: string;
  answered_by: string;
  attempt: number;
  cost_usd: number;
  created_at: string;
};

const recentHandoffs = 5;

function recent(storage: Storage, worker: string) {
  const rows = storage.database
    .prepare(
      `SELECT h.task_id, t.brief, h.receiver, h.contract, h.validation, h.gate, h.gate_reason,
       h.model, h.answered_by, h.attempt, h.cost_usd, h.created_at
       FROM handoffs h JOIN tasks t ON t.id = h.task_id
       WHERE h.sender = ? ORDER BY h.created_at DESC, h.id DESC LIMIT ?`,
    )
    .all(worker, recentHandoffs) as HandoffRow[];
  return rows.map((row) => ({
    taskId: row.task_id,
    task: row.brief.split("\n")[0]?.slice(0, 120) ?? "",
    receiver: row.receiver,
    contract: row.contract,
    validation: row.validation,
    gate: row.gate,
    gateReason: row.gate_reason,
    model: row.answered_by || row.model,
    attempt: row.attempt,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  }));
}

type Lookups = {
  slots: SlotConfig;
  capabilities: ReturnType<typeof capabilityLookup>;
  families: ReturnType<typeof familyLookup>;
};

function workerRow(storage: Storage, manifest: WorkerManifest, lookups: Lookups) {
  const resolution = resolveWorker(manifest, lookups.slots, lookups.capabilities);
  const model = resolution.model;
  const checks = capabilityChecks(manifest, model ? lookups.capabilities(model) : undefined);
  if (manifest.requires.reviewer_family_rule === "different") {
    checks.push(model ? familyCheck(lookups.families(model)) : familyCheck(undefined));
  }
  return {
    id: manifest.id,
    role: manifest.role,
    wave: manifest.wave,
    mission: manifest.mission,
    model: model ?? null,
    level: resolution.level ?? null,
    verdict: resolution.verdict,
    problems: resolution.problems,
    checks,
    handoffs: recent(storage, manifest.id),
  };
}

export function workerReport(desk: ReportDesk) {
  const { storage, registry } = desk;
  const lookups: Lookups = {
    slots: storage.getSetting<SlotConfig>("slots") ?? emptySlots,
    capabilities: capabilityLookup(storage, registry),
    families: familyLookup(storage, registry),
  };
  const groups = divisions.flatMap((division) => {
    const members = desk.manifests.filter((manifest) => manifest.division === division);
    if (members.length === 0) return [];
    const byWave = [...members].sort((a, b) => a.wave - b.wave || a.role.localeCompare(b.role));
    return [{ division, workers: byWave.map((manifest) => workerRow(storage, manifest, lookups)) }];
  });
  return { divisions: groups };
}
