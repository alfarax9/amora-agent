import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatRequest, ChatResponse } from "../src/model-layer/gateway.ts";
import type { Agency } from "../src/runtime/agency.ts";
import { loadContracts } from "../src/runtime/contracts.ts";
import { createLogger } from "../src/runtime/logger.ts";
import type { WorkerManifest } from "../src/runtime/manifest-schema.ts";
import { createOrchestrator } from "../src/runtime/orchestrator.ts";
import { openStorage } from "../src/runtime/storage.ts";

// A small agency for orchestrator tests: a planner, a builder whose gate asks
// a reviewer, and a reviewer marked ≠, all answering from scripted replies.

export function manifest(id: string, overrides: Partial<WorkerManifest> = {}): WorkerManifest {
  return {
    id,
    division: "nexus",
    wave: 1,
    role: `Role ${id}`,
    mission: `Mission of ${id}.`,
    requires: {
      vision: false,
      tool_use: false,
      structured_output: false,
      min_context: 0,
      reviewer_family_rule: "none",
    },
    model_slot: id,
    prompt: `prompts/${id}.md`,
    plugins: [],
    memory: { project: false, global_patterns: false },
    input_contract: "brief.v1",
    output_contract: "note.v1",
    quality_gate: ["schema_valid"],
    permissions: { shell: [], network: false },
    budget: { max_usd_per_task: 1, max_retries: 3 },
    ...overrides,
  };
}

const builtIn = loadContracts(fileURLToPath(new URL("../contracts", import.meta.url))).items;

function noteContract() {
  const root = mkdtempSync(join(tmpdir(), "amora-contracts-"));
  const schema = {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  };
  writeFileSync(join(root, "note.v1.json"), JSON.stringify(schema));
  return loadContracts(root).items;
}

// Replies per contract, in order; the last one repeats. A string is sent as
// is, anything else as JSON; an Error is thrown.
export type Script = Record<string, unknown[]>;

export const plan = (steps: string[], estimate = 0.1) => ({
  summary: "Deliver the feature.",
  steps: steps.map((worker) => ({ worker, goal: `Goal for ${worker}` })),
  estimate_usd: estimate,
});

export const passing = { verdict: "pass", findings: [] };
export const failing = (finding: string) => ({ verdict: "fail", findings: [finding] });

type Options = {
  families?: Record<string, string>;
  builderGate?: WorkerManifest["quality_gate"];
  costPerCall?: number;
  dailyUsd?: number;
};

export function setup(script: Script, options: Options = {}) {
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
  if (options.dailyUsd !== undefined) storage.setSetting("budgets", { dailyUsd: options.dailyUsd });
  const requests: ChatRequest[] = [];
  const queues = Object.fromEntries(Object.entries(script).map(([key, list]) => [key, [...list]]));
  const chat = async (request: ChatRequest): Promise<ChatResponse> => {
    requests.push(request);
    const name = (request.response_format?.json_schema as { name: string }).name;
    const queue = queues[name] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    const content = typeof next === "string" ? next : JSON.stringify(next);
    const usage = { cost: options.costPerCall ?? 0, prompt_tokens: 10, completion_tokens: 5 };
    return { choices: [{ message: { content } }], model: `answered-${request.model}`, usage };
  };
  const families = options.families ?? { "fake/alpha": "alpha", "fake/beta": "beta" };
  const agency: Agency = {
    storage,
    manifests: [
      manifest("planner-decomposer", { output_contract: "plan.v1" }),
      manifest("builder", {
        quality_gate: options.builderGate ?? ["schema_valid", { reviewed_by: "checker" }],
      }),
      manifest("checker", {
        output_contract: "review.v1",
        requires: { ...manifest("x").requires, reviewer_family_rule: "different" },
      }),
    ],
    contracts: [...builtIn, ...noteContract()],
    readPrompt: (worker) => `You are ${worker.role}.`,
    slots: () => ({ global: "fake/alpha", divisions: {}, workers: { checker: "fake/beta" } }),
    lookup: () => ({
      vision: false,
      tool_use: false,
      structured_output: "json_schema",
      context: 1,
    }),
    families: (model) => (families[model] ? [families[model]] : undefined),
    connect: async (model) => ({ chat, name: model }),
  };
  const orchestrator = createOrchestrator(agency, { logger: createLogger(() => undefined) });
  return { storage, requests, orchestrator, agency };
}
