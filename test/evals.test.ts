import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runAcceptance } from "../src/evals/acceptance.ts";
import { runSuite } from "../src/evals/run.ts";
import { loadSuite } from "../src/evals/suite.ts";
import type { ChatRequest, ChatResponse } from "../src/model-layer/gateway.ts";
import type { Agency } from "../src/runtime/agency.ts";
import { loadContracts } from "../src/runtime/contracts.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { loadManifests } from "../src/runtime/manifests.ts";
import { openStorage } from "../src/runtime/storage.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const suite = loadSuite(join(root, "evals"));
const contracts = loadContracts(join(root, "contracts")).items;
const briefOf = (id: string) => {
  const brief = suite.items.find((item) => item.id === id);
  if (!brief) throw new Error(`no brief ${id}`);
  return brief;
};

describe("benchmark set", () => {
  it("ships eleven briefs on two projects, most of them held out", () => {
    assert.deepEqual(suite.errors, []);
    assert.equal(suite.items.length, 11);
    assert.equal(suite.items.filter(({ heldOut }) => heldOut).length, 9);
  });

  it("has hidden tests that fail on the untouched project and pass with the reference solution", async () => {
    for (const brief of suite.items) {
      const untouched = mkdtempSync(join(tmpdir(), "amora-eval-"));
      cpSync(brief.project, untouched, { recursive: true });
      const solved = mkdtempSync(join(tmpdir(), "amora-eval-"));
      cpSync(brief.project, solved, { recursive: true });
      cpSync(brief.solution, solved, { recursive: true });
      assert.ok(
        (await runAcceptance(brief.acceptance, untouched)).failed > 0,
        `${brief.id} untouched`,
      );
      const passing = await runAcceptance(brief.acceptance, solved);
      assert.equal(passing.failed, 0, `${brief.id} solution: ${passing.output}`);
      assert.ok(passing.passed > 0, brief.id);
    }
  });

  it("counts a hidden test that runs no tests as a failure", async () => {
    const folder = mkdtempSync(join(tmpdir(), "amora-eval-"));
    const empty = join(folder, "empty.test.mjs");
    writeFileSync(empty, "// no tests\n");
    const result = await runAcceptance(empty, folder);
    assert.deepEqual([result.passed, result.failed], [0, 1]);
  });

  it("counts a hidden test that never finishes as a failure", async () => {
    const folder = mkdtempSync(join(tmpdir(), "amora-eval-"));
    const stuck = join(folder, "stuck.test.mjs");
    writeFileSync(stuck, "setInterval(() => {}, 1000);\nawait new Promise(() => {});\n");
    const result = await runAcceptance(stuck, folder, 1000);
    assert.deepEqual([result.passed, result.failed], [0, 1]);
  });

  it("names each broken brief and keeps loading the others", () => {
    const broken = mkdtempSync(join(tmpdir(), "amora-evals-"));
    cpSync(join(root, "evals"), broken, { recursive: true });
    writeFileSync(join(broken, "briefs", "tax", "brief.json"), '{"id": "tax"}');
    rmSync(join(broken, "briefs", "faq", "acceptance.test.mjs"));
    const pricing = JSON.parse(
      readFileSync(join(broken, "briefs", "pricing", "brief.json"), "utf8"),
    );
    writeFileSync(
      join(broken, "briefs", "pricing", "brief.json"),
      JSON.stringify({ ...pricing, id: "prices" }),
    );
    const renamed = JSON.parse(
      readFileSync(join(broken, "briefs", "summary", "brief.json"), "utf8"),
    );
    writeFileSync(
      join(broken, "briefs", "summary", "brief.json"),
      JSON.stringify({ ...renamed, project: "nowhere" }),
    );
    const { items, errors } = loadSuite(broken);
    assert.equal(items.length, 7);
    assert.ok(errors.includes("evals/briefs/faq: acceptance.test.mjs is missing"));
    assert.ok(errors.includes('evals/briefs/pricing: id is "prices" but the folder is pricing'));
    assert.ok(
      errors.some((error) => error.startsWith("evals/briefs/tax: / must have required property")),
    );
    assert.ok(errors.includes("evals/briefs/summary: project nowhere has no package.json"));
  });
});

const taxSolution = readFileSync(join(briefOf("tax").solution, "src", "tax.js"), "utf8");
// Passes the project's own checks, but taxes exempt items: only the hidden
// test can tell.
const taxWrong = `export function totalWithTax(cart, rate) {
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

function fakeAgency(taxCode: string, review: unknown = pass) {
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

async function benchmark(taxCode: string) {
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
    },
    [briefOf("tax")],
  );
}

describe("benchmark runner, with scripted models", () => {
  it("runs a brief through the thin path and the baseline, and scores both with the hidden test", async () => {
    const rows = await benchmark(taxSolution);
    const why = JSON.stringify(rows.map(({ system, reason }) => [system, reason]));
    assert.deepEqual(
      rows.map(({ system, delivered, success, failed }) => [system, delivered, success, failed]),
      [
        ["amora", true, true, 0],
        ["slim", true, true, 0],
        ["baseline", true, true, 0],
      ],
      why,
    );
    // Planner, PM, UX, then the Slice Engineer, Logic Developer, and Tester,
    // each with its review.
    assert.equal(rows[0]?.calls, 9);
    // Planner, then the Frontend Engineer and the Tester, each with its review.
    assert.equal(rows[1]?.calls, 5);
    assert.equal(rows[2]?.calls, 1);
    assert.equal(rows[2]?.tokensIn, 100);
    assert.match(readFileSync(join(rows[0]?.project ?? "", "src", "tax.js"), "utf8"), /taxExempt/);
  });

  it("counts delivered work that fails the hidden test as no success", async () => {
    const rows = await benchmark(taxWrong);
    assert.ok(
      rows.every((row) => row.delivered && !row.success && row.failed > 0),
      JSON.stringify(rows.map(({ system, reason }) => [system, reason])),
    );
  });
});

describe("benchmark runner, when the baseline fails its checks", () => {
  it("keeps the failing check's output in the reason", async () => {
    const contract = contracts.find(({ id }) => id === "code_change.v1");
    if (!contract) throw new Error("code_change.v1 is missing");
    const out = mkdtempSync(join(tmpdir(), "amora-evals-out-"));
    const run = {
      agency: fakeAgency("export function totalWithTax( {"),
      baselineModel: "fake/alpha",
      baselinePrompt: "Do it all.",
      contract,
      out,
      budgetUsd: 1,
      logger: createLogger(() => undefined),
      systems: ["baseline" as const],
    };
    const [row] = await runSuite(run, [briefOf("tax")]);
    assert.equal(row?.delivered, false);
    assert.match(row?.reason ?? "", /in 3 attempts\. npm run typecheck failed\. .*SyntaxError/);
  });
});

describe("benchmark runner, when AMORA stops", () => {
  it("reports the task's own stop reason and delivers nothing", async () => {
    const contract = contracts.find(({ id }) => id === "code_change.v1");
    if (!contract) throw new Error("code_change.v1 is missing");
    const agency = fakeAgency(taxSolution, { verdict: "fail", findings: ["Not good enough."] });
    const out = mkdtempSync(join(tmpdir(), "amora-evals-out-"));
    const run = {
      agency,
      baselineModel: "fake/alpha",
      baselinePrompt: "Do it all.",
      contract,
      out,
      budgetUsd: 1,
      logger: createLogger(() => undefined),
      systems: ["amora" as const],
    };
    const [row] = await runSuite(run, [briefOf("tax")]);
    assert.equal(row?.delivered, false);
    assert.match(row?.reason ?? "", /did not pass its gate after 3 attempts/);
    assert.equal(row?.success, false);
  });
});
