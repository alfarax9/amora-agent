import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ChatRequest, ChatResponse } from "../src/model-layer/gateway.ts";
import type { Agency } from "../src/runtime/agency.ts";
import { loadContracts } from "../src/runtime/contracts.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { loadManifests } from "../src/runtime/manifests.ts";
import { createOrchestrator } from "../src/runtime/orchestrator.ts";
import { openStorage } from "../src/runtime/storage.ts";
import { getTask, listHandoffs, listMessages } from "../src/runtime/task-store.ts";

// The whole thin path on a fixture project: the nine real manifests, prompts,
// and contracts, the project's real lint, typecheck, and test scripts, and
// scripted model replies. Only the models are fake.

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = join(root, "test", "fixtures", "pricing-site");

const file = (path: string, content: string) => ({ path, content });
const code = (summary: string, files: { path: string; content: string }[]) => ({
  summary,
  files,
  notes: [],
});

const plans = `export const plans = [
  { name: "Starter", price: 0 },
  { name: "Team", price: 12 },
  { name: "Business", price: 30 },
];
`;
const cards = `import { formatPrice } from "./price.js";

export function renderPricing(plans) {
  const cards = plans.map((plan) => \`<li><h2>\${plan.name}</h2><p>\${formatPrice(plan.price)}</p></li>\`);
  return \`<section aria-labelledby="pricing"><h2 id="pricing">Pricing</h2><ul>\${cards.join("")}</ul></section>\`;
}
`;
const price = `export function formatPrice(amount) {
  return amount === 0 ? "Free" : \`$\${amount.toFixed(2)} per month\`;
}
`;
const tests = `import assert from "node:assert/strict";
import { test } from "node:test";
import { plans } from "../src/plans.js";
import { formatPrice } from "../src/price.js";
import { renderPricing } from "../src/pricing.js";

test("shows three plans", () => {
  assert.equal(renderPricing(plans).match(/<li>/g).length, 3);
});

test("shows a free plan as Free and others per month with two decimals", () => {
  assert.equal(formatPrice(0), "Free");
  assert.equal(formatPrice(12), "$12.00 per month");
});
`;

// Replies per contract, in order. The Slice / Markup Engineer's first try
// does not parse, so the project's own typecheck sends it back.
// The Logic Developer's first price formatting drops the decimals, so the
// Tester's test fails on it and the work goes back.
const buggyPrice = `export function formatPrice(amount) {
  return amount === 0 ? "Free" : \`$\${amount} per month\`;
}
`;

const suite = (defects: unknown[]) => ({
  ...code("Tests for the acceptance criteria.", [file("tests/pricing.test.js", tests)]),
  covers: ["Three plans are shown.", "A free plan shows Free."],
  defects,
});

const priceDefect = {
  file: "src/price.js",
  problem: 'formatPrice(12) gives "$12 per month"; it must give "$12.00 per month".',
};

function codeChanges(bug: boolean): unknown[] {
  const once = [
    code("Price formatting.", [file("src/price.js", price)]),
    code("Plan data.", [file("src/plans.js", plans)]),
    code("Nothing to optimise; the section renders once.", []),
  ];
  if (!bug) return once;
  return [code("Price formatting.", [file("src/price.js", buggyPrice)]), ...once.slice(1), ...once];
}

function script(bug = false): Record<string, unknown[]> {
  return {
    plan_v1: [
      {
        summary: "A pricing section with three plans, tested.",
        steps: [
          "product-manager",
          "ux-architect",
          "fe-slice-engineer",
          "fe-logic-developer",
          "fe-api-integration",
          "fe-performance",
          "unit-integration-tester",
        ].map((worker) => ({
          worker,
          goal: `The ${worker} part of the pricing section.`,
          acceptance: `The ${worker} part works.`,
        })),
      },
    ],
    requirements_v1: [
      {
        feature: "A pricing section with three plans.",
        user_stories: [
          {
            story: "As a visitor, I want to compare plans, so that I can choose one.",
            acceptance_criteria: ["Three plans are shown.", "A free plan shows Free."],
          },
        ],
        out_of_scope: ["Checkout."],
        open_questions: [],
      },
    ],
    design_spec_v1: [
      {
        screens: [
          {
            name: "Pricing",
            purpose: "Compare plans.",
            layout: "A heading, then one card per plan; cards stack on small screens.",
            components: [
              { name: "Plan card", purpose: "One plan.", states: ["default"], content: ["Free"] },
            ],
            interactions: [],
          },
        ],
        accessibility: ["The section is labelled by its heading."],
      },
    ],
    component_pkg_v1: [
      {
        ...code("Pricing cards.", [file("src/pricing.js", "export function renderPricing( {")]),
        components: [{ name: "Pricing", path: "src/pricing.js", covers: "Plan card" }],
      },
      {
        ...code("Pricing cards.", [file("src/pricing.js", cards)]),
        components: [{ name: "Pricing", path: "src/pricing.js", covers: "Plan card" }],
      },
    ],
    code_change_v1: codeChanges(bug),
    test_suite_v1: bug ? [suite([priceDefect]), suite([])] : [suite([])],
    review_v1: [{ verdict: "pass", findings: [] }],
  };
}

function agencyFor(storage: ReturnType<typeof openStorage>, bug: boolean) {
  const queues = script(bug);
  const requests: ChatRequest[] = [];
  const chat = async (request: ChatRequest): Promise<ChatResponse> => {
    requests.push(request);
    const name = (request.response_format?.json_schema as { name: string }).name;
    const queue = queues[name] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return { choices: [{ message: { content: JSON.stringify(next) } }], model: request.model };
  };
  const strong = {
    vision: true,
    tool_use: true,
    structured_output: "json_schema" as const,
    context: 1e6,
  };
  const agency: Agency = {
    storage,
    manifests: loadManifests(join(root, "workers")).items,
    contracts: loadContracts(join(root, "contracts")).items,
    readPrompt: (manifest) => readFileSync(join(root, manifest.prompt), "utf8"),
    slots: () => ({
      global: "fake/alpha",
      divisions: {},
      workers: { "reality-checker": "fake/beta" },
    }),
    lookup: () => strong,
    families: (model) => [model === "fake/beta" ? "beta" : "alpha"],
    connect: async (model) => ({ chat, name: model }),
    workspaces: mkdtempSync(join(tmpdir(), "amora-workspaces-")),
    backups: mkdtempSync(join(tmpdir(), "amora-backups-")),
    price: async () => ({ inputPerMillion: 0, outputPerMillion: 0 }),
  };
  return { agency, requests };
}

async function runTask(bug = false) {
  const project = mkdtempSync(join(tmpdir(), "amora-project-"));
  cpSync(fixture, project, { recursive: true });
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
  storage.setSetting("budgets", { dailyUsd: 5 });
  const { agency, requests } = agencyFor(storage, bug);
  const orchestrator = createOrchestrator(agency, { logger: createLogger(() => undefined) });
  const { id } = orchestrator.create("Add a pricing section with three plans.", 1, project);
  await orchestrator.settled(id);
  await orchestrator.approve(id);
  await orchestrator.settled(id);
  return { project, storage, requests, orchestrator, id };
}

type Run = Awaited<ReturnType<typeof runTask>>;

function checkLog({ storage, requests, id }: Run) {
  const log = listHandoffs(storage, id);
  const slices = log.filter((handoff) => handoff.sender === "fe-slice-engineer");
  assert.deepEqual(
    slices.map(({ attempt, gate }) => [attempt, gate]),
    [
      [1, "failed"],
      [2, "passed"],
    ],
  );
  assert.match(slices[0]?.gateReason ?? "", /npm run typecheck failed/);
  assert.deepEqual(slices[1]?.artifacts, ["src/pricing.js"]);
  const reviews = log.filter((handoff) => handoff.sender === "reality-checker");
  assert.ok(reviews.every(({ model }) => model === "fake/beta"));
  assert.equal(reviews.length, 5);
  const retried = requests.some((request) =>
    String(request.messages[1]?.content).includes("npm run typecheck failed"),
  );
  assert.ok(retried, "the failed check went back to the Slice / Markup Engineer");
}

// Without removing it, the child test run reports to this test runner instead
// of stdout.
function npmTest(folder: string): string {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const windows = process.platform === "win32";
  return execFileSync(windows ? "npm.cmd" : "npm", ["test", "--silent"], {
    cwd: folder,
    env,
    encoding: "utf8",
    shell: windows,
  });
}

describe("thin path, end to end on a fixture project", () => {
  it("runs every step through its gate without touching the project", async () => {
    const run = await runTask();
    const finished = getTask(run.storage, run.id);
    assert.equal(finished?.status, "awaiting_decision", finished?.reason);
    assert.match(finished?.reason ?? "", /Every step passed its gate/);
    assert.ok(!existsSync(join(run.project, "src", "pricing.js")));
    checkLog(run);
  });

  it("delivers the tested feature to the project when the owner completes the task", async () => {
    const run = await runTask();
    run.orchestrator.decide(run.id, { action: "complete" });
    assert.equal(getTask(run.storage, run.id)?.status, "completed");
    const written = ["src/plans.js", "src/price.js", "src/pricing.js", "tests/pricing.test.js"];
    for (const path of written) assert.ok(existsSync(join(run.project, path)), path);
    const report = listMessages(run.storage, run.id).at(-2)?.text ?? "";
    assert.match(
      report,
      new RegExp(
        `^Wrote 4 files to .*: ${written.join(", ")}\\. .*amora undo ${run.id.slice(0, 8)}$`,
      ),
    );
    assert.match(npmTest(run.project), /pass 3/);
  });

  // A loop with no limit would hang here instead of failing.
  it(
    "sends a bug the Tester's tests find back to the Logic Developer, who fixes it",
    { timeout: 60_000 },
    async () => {
      const run = await runTask(true);
      const finished = getTask(run.storage, run.id);
      assert.match(finished?.reason ?? "", /Every step passed its gate/, finished?.reason);
      const code = ["fe-logic-developer", "fe-api-integration", "fe-performance"];
      const sequence = listHandoffs(run.storage, run.id)
        .filter(({ sender }) => [...code, "unit-integration-tester"].includes(sender))
        .map(({ sender, gate }) => `${sender} ${gate}`);
      const round = (tester: string) => [...code.map((worker) => `${worker} passed`), tester];
      assert.deepEqual(sequence, [
        ...round("unit-integration-tester failed"),
        ...round("unit-integration-tester passed"),
      ]);
      // Only the step that wrote the faulty file and the ones after it run again.
      const passed = (sender: string) =>
        listHandoffs(run.storage, run.id).filter((h) => h.sender === sender && h.gate === "passed");
      for (const earlier of ["product-manager", "ux-architect", "fe-slice-engineer"]) {
        assert.equal(passed(earlier).length, 1, earlier);
      }
      const report =
        "Unit & Integration Tester found a defect in src/price.js; the work goes back to Logic Developer.";
      assert.ok(listMessages(run.storage, run.id).some(({ text }) => text === report));
      const fix = run.requests.find((request) =>
        String(request.messages[1]?.content).includes("src/price.js: formatPrice(12) gives"),
      );
      assert.ok(fix, "the Logic Developer heard about the defect");
      run.orchestrator.decide(run.id, { action: "complete" });
      assert.match(readFileSync(join(run.project, "src", "price.js"), "utf8"), /toFixed\(2\)/);
      assert.match(npmTest(run.project), /pass 3/);
    },
  );
});
