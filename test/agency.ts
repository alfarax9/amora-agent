import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatRequest, ChatResponse } from "../src/model-layer/gateway.ts";
import type { Agency } from "../src/runtime/agency.ts";
import { loadContracts } from "../src/runtime/contracts.ts";
import { createLogger } from "../src/runtime/logger.ts";
import type { WorkerManifest } from "../src/runtime/manifest-schema.ts";
import {
  createOrchestrator,
  type Decision,
  type Orchestrator,
} from "../src/runtime/orchestrator.ts";
import { openStorage, type Storage } from "../src/runtime/storage.ts";
import { getTask, listTasks } from "../src/runtime/task-store.ts";

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

export const plan = (steps: string[]) => ({
  summary: "Deliver the feature.",
  steps: steps.map((worker) => ({ worker, goal: `Goal for ${worker}` })),
});

export const passing = { verdict: "pass", findings: [] };
export const failing = (finding: string) => ({ verdict: "fail", findings: [finding] });

type Options = {
  families?: Record<string, string>;
  builderGate?: WorkerManifest["quality_gate"];
  builderNeeds?: string;
  builder?: Partial<WorkerManifest>;
  // More workers after the builder, the checker, and the planner.
  extra?: WorkerManifest[];
  // USD per million tokens, in and out, for every model.
  pricePerMillion?: number;
  costPerCall?: number;
  dailyUsd?: number;
  // Resume tasks paused for quota by themselves, as the runtime does.
  autoResume?: boolean;
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
        input_contract: options.builderNeeds ?? "brief.v1",
        quality_gate: options.builderGate ?? ["schema_valid", { reviewed_by: "checker" }],
        ...options.builder,
      }),
      manifest("checker", {
        output_contract: "review.v1",
        requires: { ...manifest("x").requires, reviewer_family_rule: "different" },
      }),
      ...(options.extra ?? []),
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
    workspaces: mkdtempSync(join(tmpdir(), "amora-workspaces-")),
    backups: mkdtempSync(join(tmpdir(), "amora-backups-")),
    retryDelaysMs: [0, 0],
    price: async (model) =>
      model.startsWith("fake/")
        ? {
            inputPerMillion: options.pricePerMillion ?? 0,
            outputPerMillion: options.pricePerMillion ?? 0,
          }
        : undefined,
  };
  const autoResume = options.autoResume ?? false;
  const runtime = createOrchestrator(agency, { logger: createLogger(() => undefined), autoResume });
  return { storage, requests, orchestrator: waitingFor(runtime, storage), runtime, agency };
}

// The orchestrator answers at once and works in the background; tests mostly
// want the task as it is once that work is done.
function waitingFor(runtime: Orchestrator, storage: Storage) {
  const after = async (id: string) => {
    await runtime.settled(id);
    const task = getTask(storage, id);
    if (!task) throw new Error(`task ${id} is gone`);
    return task;
  };
  return {
    ...runtime,
    submit: async (brief: string, budgetUsd: number) => after(runtime.create(brief, budgetUsd).id),
    approve: async (id: string) => (await runtime.approve(id), after(id)),
    revise: async (id: string, feedback: string) => (runtime.revise(id, feedback), after(id)),
    decide: async (id: string, decision: Decision) => (runtime.decide(id, decision), after(id)),
    resumeAll: async () => {
      runtime.resumeAll();
      await Promise.all(listTasks(storage).map((task) => runtime.settled(task.id)));
    },
  };
}
