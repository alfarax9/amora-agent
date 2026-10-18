import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sendBackTarget } from "../src/runtime/send-back.ts";
import { getTask, type Handoff, listHandoffs, listMessages } from "../src/runtime/task-store.ts";
import { manifest, plan, setup } from "./agency.ts";

const defect = { file: "src/a.js", problem: "a must be 2" };

function handoff(sender: string, artifacts: string[], gate: Handoff["gate"] = "passed"): Handoff {
  return {
    taskId: "t",
    sender,
    receiver: "x",
    contract: "code_change.v1",
    validation: "valid",
    gate,
    gateReason: "",
    model: "m",
    answeredBy: "m",
    attempt: 1,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    content: null,
    artifacts,
  };
}

describe("sending work back: which step", () => {
  const steps = plan(["first", "second", "tester"]);
  const failedTests = (defects: unknown[], check = "tests_pass") => ({
    result: "failed" as const,
    reason: "npm run test failed.",
    findings: ["1 failing"],
    check,
    output: { defects },
  });
  const log = [handoff("first", ["src/a.js", "src/b.js"]), handoff("second", ["src/b.js"])];

  it("picks the earliest earlier step that last wrote a named file", () => {
    const both = [defect, { file: "src/b.js", problem: "b" }];
    assert.deepEqual(sendBackTarget(steps, 2, log, failedTests(both))?.step, 0);
    const onlyB = [{ file: "src/b.js", problem: "b" }];
    assert.deepEqual(sendBackTarget(steps, 2, log, failedTests(onlyB)), {
      step: 1,
      worker: "second",
      defects: onlyB,
    });
  });

  it("keeps the work when no defect is named, a named file no step wrote, or another check failed", () => {
    assert.equal(sendBackTarget(steps, 2, log, failedTests([])), undefined);
    assert.equal(
      sendBackTarget(steps, 2, log, failedTests([{ file: "src/z.js", problem: "z" }])),
      undefined,
    );
    assert.equal(
      sendBackTarget(steps, 2, log, failedTests([defect], "lint_and_typecheck_pass")),
      undefined,
    );
    assert.equal(
      sendBackTarget(steps, 2, [handoff("first", ["src/a.js"], "failed")], failedTests([defect])),
      undefined,
    );
    assert.equal(sendBackTarget(steps, 2, log, failedTests([{ file: 1 }])), undefined);
  });
});

// A builder writes src/a.js; the project's own test passes only when a is 2.
function world(code: number[], suites: unknown[]) {
  const project = mkdtempSync(join(tmpdir(), "amora-project-"));
  mkdirSync(join(project, "src"));
  const check = "node -e \"import('./src/a.js').then((m) => process.exit(m.a === 2 ? 0 : 1))\"";
  writeFileSync(join(project, "package.json"), JSON.stringify({ scripts: { test: check } }));
  const testFile = { path: "tests/a.test.js", content: "// expects a to be 2\n" };
  const tester = manifest("tester", {
    output_contract: "test_suite.v1",
    plugins: [{ filesystem: { scope: "tests/**" } }],
    permissions: { shell: ["npm"], network: false },
    quality_gate: ["schema_valid", "files_in_scope", "tests_pass"],
  });
  const built = setup(
    {
      plan_v1: [plan(["builder", "tester"])],
      code_change_v1: code.map((a) => ({
        summary: `a is ${a}`,
        files: [{ path: "src/a.js", content: `export const a = ${a};\n` }],
        notes: [],
      })),
      test_suite_v1: suites.map((defects) => ({
        summary: "Tests.",
        covers: ["a is 2"],
        files: [testFile],
        notes: [],
        defects,
      })),
    },
    {
      dailyUsd: 5,
      extra: [tester],
      builder: {
        output_contract: "code_change.v1",
        plugins: [{ filesystem: { scope: "src/**" } }],
        quality_gate: ["schema_valid", "files_in_scope"],
      },
    },
  );
  return { ...built, project };
}

async function run(built: ReturnType<typeof world>) {
  const { id } = built.runtime.create("Make a equal 2.", 1, built.project);
  await built.runtime.settled(id);
  await built.runtime.approve(id);
  await built.runtime.settled(id);
  return id;
}

// A loop with no limit would hang instead of failing, so each test has a limit.
describe("sending work back: in a task", { timeout: 60_000 }, () => {
  it("returns a defect the Tester found to the builder, then runs the Tester again", async () => {
    const built = world([1, 2], [[defect], []]);
    const id = await run(built);
    assert.match(getTask(built.storage, id)?.reason ?? "", /Every step passed/);
    assert.deepEqual(
      listHandoffs(built.storage, id)
        .map(({ sender, gate }) => `${sender} ${gate}`)
        .slice(1),
      ["builder passed", "tester failed", "builder passed", "tester passed"],
    );
    assert.ok(
      listMessages(built.storage, id).some(
        ({ text }) =>
          text === "Role tester found a defect in src/a.js; the work goes back to Role builder.",
      ),
    );
    const retry = built.requests.filter((request) => request.model === "fake/alpha").at(-2);
    const input = String(retry?.messages[1]?.content);
    assert.match(input, /Role tester's tests fail on your code/);
    assert.match(input, /src\/a.js: a must be 2/);
    assert.match(input, /Test file tests\/a.test.js/);
    assert.equal(getTask(built.storage, id)?.returns, 1);
  });

  it("asks the owner once the work has gone back as often as the Tester may attempt", async () => {
    const built = world([1], [[defect]]);
    const id = await run(built);
    const task = getTask(built.storage, id);
    assert.equal(task?.status, "awaiting_decision");
    assert.match(
      task?.reason ?? "",
      /Role tester still finds defects in src\/a.js after the work went back 3 times/,
    );
    const builds = listHandoffs(built.storage, id).filter(({ sender }) => sender === "builder");
    assert.equal(builds.length, 4);
  });

  it("keeps the work with the Tester when it names no defect", async () => {
    const built = world([1], [[]]);
    const id = await run(built);
    assert.match(
      getTask(built.storage, id)?.reason ?? "",
      /tester did not pass its gate after 3 attempts/,
    );
    const builds = listHandoffs(built.storage, id).filter(({ sender }) => sender === "builder");
    assert.equal(builds.length, 1);
  });
});
