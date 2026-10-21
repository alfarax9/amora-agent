import { saveCombo, saveProbeResults } from "../src/model-layer/known-models.ts";
import type { Registry } from "../src/model-layer/registry.ts";
import type { Price } from "../src/runtime/estimate.ts";
import type { ReportDesk } from "../src/runtime/report-routes.ts";
import type { SecretStore } from "../src/runtime/secrets.ts";
import type { Storage } from "../src/runtime/storage.ts";
import { createTask, type Handoff, recordHandoff, saveTask } from "../src/runtime/task-store.ts";
import { manifest } from "./agency.ts";

// An agency for the Workers, Models, and Costs pages: three workers in three
// divisions, a probed model, a half-probed combo, a registry model, and
// handoffs with a failed gate, a call with no reported cost, and one older
// than the 30-day window.

export const openRouterKey = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;

const capabilities = (vision: boolean, context: number) => [
  { capability: "vision" as const, result: String(vision), detail: "looked at the square" },
  { capability: "tool_use" as const, result: "true", detail: "called the tool" },
  { capability: "structured_output" as const, result: "json_schema", detail: "strict schema" },
  { capability: "context" as const, result: String(context), detail: "from the gateway" },
];

const pricing = {
  source: "https://example.com/pricing",
  effective_from: "2026-10-01",
  per_million: { input: 1, output: 2 },
  reasoning_billed_as: "output" as const,
  tiers: [],
  time_windows: [],
};

const registry: Registry = {
  version: 1,
  models: [
    {
      model: "openrouter/listed",
      base_family: "claude",
      license: "proprietary",
      expires: null,
      capabilities: { vision: true, tool_use: true, structured_output: "json_schema", context: 1 },
      probe_date: "2026-10-01",
      pricing,
    },
  ],
};

const requires = (fields: Partial<ReturnType<typeof manifest>["requires"]>) => ({
  vision: false,
  tool_use: false,
  structured_output: false,
  min_context: 0,
  reviewer_family_rule: "none" as const,
  ...fields,
});

const manifests = [
  manifest("builder", {
    division: "forge",
    role: "Builder",
    requires: requires({ vision: true, tool_use: true, min_context: 64_000 }),
  }),
  manifest("reviewer", {
    division: "crucible",
    role: "Reviewer",
    wave: 2,
    requires: requires({ structured_output: true, reviewer_family_rule: "different" }),
  }),
  manifest("planner", { division: "nexus", role: "Planner" }),
];

const handoff = (fields: Partial<Handoff>): Handoff => ({
  taskId: "",
  sender: "builder",
  receiver: "owner",
  contract: "note.v1",
  validation: "valid",
  gate: "passed",
  gateReason: "",
  model: "openrouter/a",
  answeredBy: "openrouter/a",
  attempt: 1,
  tokensIn: 1000,
  tokensOut: 500,
  costUsd: 0.25,
  content: { summary: "done" },
  artifacts: [],
  ...fields,
});

function seedModels(storage: Storage): void {
  storage.setSetting("slots", {
    global: "openrouter/a",
    divisions: { crucible: "omniroute/combo" },
    workers: { planner: "openrouter/listed" },
  });
  saveProbeResults(storage, "openrouter/a", capabilities(false, 128_000), new Date());
  saveProbeResults(storage, "omniroute/m1", capabilities(true, 32_000), new Date("2026-01-02"));
  saveCombo(storage, "omniroute/combo", {
    members: ["omniroute/m1", "omniroute/m2"],
    contextLength: null,
    strategy: "priority",
  });
}

function seedTasks(storage: Storage): string {
  storage.setSetting("budgets", { dailyUsd: 0.5 });
  const task = createTask(storage, "Build the pricing card\nwith three tiers", 2);
  const plan = { summary: "s", steps: [], estimate: { usd: 0.4, unpriced: [] } };
  saveTask(storage, { ...task, status: "completed", spentUsd: 0.6, plan });
  createTask(storage, "A cancelled task", 1);
  const taskId = task.id;
  const now = Date.now();
  for (let n = 0; n < 6; n++) {
    recordHandoff(storage, handoff({ taskId, attempt: n + 1 }), new Date(now - 1000 * (6 - n)));
  }
  const failed = { gate: "failed" as const, gateReason: "Visual diff 4.2%, limit 3%" };
  recordHandoff(storage, handoff({ taskId, ...failed, costUsd: 0.1 }), new Date(now));
  const unreported = { model: "omniroute/combo", answeredBy: "m1", costUsd: 0 };
  const tokens = { tokensIn: 2_000_000, tokensOut: 1_000_000 };
  recordHandoff(
    storage,
    handoff({ taskId, sender: "reviewer", ...unreported, ...tokens }),
    new Date(now),
  );
  recordHandoff(storage, handoff({ taskId, costUsd: 9 }), new Date("2020-01-01T00:00:00Z"));
  return taskId;
}

const prices: Record<string, Price> = {
  "omniroute/combo": { inputPerMillion: 0.5, outputPerMillion: 1 },
  "openrouter/listed": { inputPerMillion: 1, outputPerMillion: 2 },
};

// The price lookup for openrouter/a fails, as when OpenRouter is down.
export async function seedReports(
  storage: Storage,
  secrets: SecretStore,
): Promise<{ desk: ReportDesk; taskId: string }> {
  await secrets.set("openrouter", openRouterKey);
  seedModels(storage);
  const taskId = seedTasks(storage);
  const price = async (model: string) => {
    if (model === "openrouter/a") throw new Error("OpenRouter is down");
    return prices[model];
  };
  return { desk: { storage, secrets, manifests, registry, price }, taskId };
}
