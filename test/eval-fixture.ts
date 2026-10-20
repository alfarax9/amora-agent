import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite, type System } from "../src/evals/run.ts";
import { loadSuite } from "../src/evals/suite.ts";
import type { ChatRequest, ChatResponse } from "../src/model-layer/gateway.ts";
import type { Agency } from "../src/runtime/agency.ts";
import { loadContracts } from "../src/runtime/contracts.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { loadManifests } from "../src/runtime/manifests.ts";
import { openStorage } from "../src/runtime/storage.ts";

// Scripted models and a fake agency for the benchmark tests: the real thin
// path, the slim roster, and the baseline, all answering from fixed replies.

export const root = fileURLToPath(new URL("..", import.meta.url));
export const suite = loadSuite(join(root, "evals"));
export const contracts = loadContracts(join(root, "contracts")).items;
export const briefOf = (id: string) => {
  const brief = suite.items.find((item) => item.id === id);
  if (!brief) throw new Error(`no brief ${id}`);
  return brief;
};

export const taxSolution = readFileSync(join(briefOf("tax").solution, "src", "tax.js"), "utf8");
// Passes the project's own checks, but taxes exempt items: only the hidden
// test can tell.
export const taxWrong = `export function totalWithTax(cart, rate) {
  const total = cart.items.reduce((sum, item) => sum + item.price * item.quantity * (1 + rate), 0);
  return Math.round(total * 100) / 100;
}
`;
const taxTests = `import assert from "node:assert/strict";
import { test } from "node:test";
import { totalWithTax } from "../src/tax.js";

test("adds tax", () => {
  assert.equal(totalWithTax({ items: [{ price: 10, quantity: 1 }] }, 0.5), 15);
});
`;

const file = (path: string, content: string) => ({ path, content });

// Replies per contract for the real thin path, plus the slim roster's plan and
// engineer, and the baseline's one answer.
const pass = { verdict: "pass", findings: [] };

function replies(taxCode: string, review: unknown = pass): Record<string, unknown> {
  const steps = [
    "product-manager",
    "ux-architect",
    "fe-slice-engineer",
    "fe-logic-developer",
    "unit-integration-tester",
  ];
  return {
    plan_v1: {
      summary: "Tax.",
      steps: steps.map((worker) => ({ worker, goal: `${worker} part` })),
    },
    requirements_v1: {
      feature: "Tax.",
      user_stories: [{ story: "As a buyer, I want tax shown.", acceptance_criteria: ["Taxed."] }],
      out_of_scope: [],
      open_questions: [],
    },
    design_spec_v1: { screens: [], accessibility: [] },
    component_pkg_v1: {
      summary: "Tax module.",
      components: [{ name: "tax", path: "src/tax.js", covers: "Tax" }],
      files: [file("src/tax.js", taxCode)],
      notes: [],
    },
    test_suite_v1: {
      summary: "Tests.",
      covers: ["Taxed."],
      files: [file("tests/tax.test.js", taxTests)],
      notes: [],
      defects: [],
    },
    // The Logic Developer finds nothing to add; the baseline delivers everything.
    code_change_v1: { summary: "Nothing to add.", files: [], notes: [] },
    baseline: {
      summary: "Tax module and tests.",
      files: [file("src/tax.js", taxCode), file("tests/tax.test.js", taxTests)],
      notes: [],
    },
    slim_plan: {
      summary: "Tax.",
      steps: ["fe-engineer", "unit-integration-tester"].map((worker) => ({ worker, goal: worker })),
    },
    engineer: { summary: "Tax module.", files: [file("src/tax.js", taxCode)], notes: [] },
    review_v1: review,
  };
}

// Which scripted answer a request gets: by contract, except for the
// baseline, the slim roster's plan, and the Frontend Engineer.
function answerFor(request: ChatRequest): string {
  const contract = (request.response_format?.json_schema as { name: string }).name;
  const prompt = String(request.messages[0]?.content);
  if (prompt.startsWith("Do it all.")) return "baseline";
  if (prompt.startsWith("You are the Frontend Engineer")) return "engineer";
  const offered = String(request.messages[1]?.content);
  if (contract === "plan_v1" && !offered.includes("product-manager")) return "slim_plan";
  return contract;
}

export function fakeAgency(taxCode: string, review: unknown = pass) {
  const answers = replies(taxCode, review);
  const chat = async (request: ChatRequest): Promise<ChatResponse> => {
    const name = answerFor(request);
    const usage = { prompt_tokens: 100, completion_tokens: 10, cost: 0.001 };
    return {
      choices: [{ message: { content: JSON.stringify(answers[name]) } }],
      model: request.model,
      usage,
    };
  };
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
  storage.setSetting("budgets", { dailyUsd: 5 });
  const strong = {
    vision: true,
    tool_use: true,
    structured_output: "json_schema" as const,
    context: 1e6,
  };
  const agency: Agency = {
    storage,
    manifests: loadManifests(join(root, "workers")).items,
    contracts,
    readPrompt: (manifest) => readFileSync(join(root, manifest.prompt), "utf8"),
    slots: () => ({
      global: "fake/alpha",
      divisions: {},
      workers: { "reality-checker": "fake/beta" },
    }),
    lookup: () => strong,
    families: (model) => [model],
    connect: async (model) => ({ chat, name: model }),
    workspaces: mkdtempSync(join(tmpdir(), "amora-workspaces-")),
    price: async () => ({ inputPerMillion: 0, outputPerMillion: 0 }),
    retryDelaysMs: [0, 0],
  };
  return agency;
}

export async function benchmark(taxCode: string) {
  const contract = contracts.find(({ id }) => id === "code_change.v1");
  if (!contract) throw new Error("code_change.v1 is missing");
  const out = mkdtempSync(join(tmpdir(), "amora-evals-out-"));
  mkdirSync(out, { recursive: true });
  return runSuite(
    {
      agency: fakeAgency(taxCode),
      baselineModel: "fake/alpha",
      baselinePrompt: "Do it all.",
      contract,
      out,
      budgetUsd: 1,
      logger: createLogger(() => undefined),
      systems: ["amora", "slim", "baseline"],
      runs: 1,
    },
    [briefOf("tax")],
  );
}

// Runs one brief through the given systems with an agency the test built.
export async function runWith(agency: Agency, systems: System[], briefId = "tax", runs = 1) {
  const contract = contracts.find(({ id }) => id === "code_change.v1");
  if (!contract) throw new Error("code_change.v1 is missing");
  const out = mkdtempSync(join(tmpdir(), "amora-evals-out-"));
  const run = {
    agency,
    baselineModel: "fake/alpha",
    baselinePrompt: "Do it all.",
    contract,
    out,
    budgetUsd: 1,
    logger: createLogger(() => undefined),
    systems,
    runs,
  };
  return runSuite(run, [briefOf(briefId)]);
}
