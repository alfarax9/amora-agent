import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { GatewayError } from "../src/model-layer/gateway.ts";
import { runHeadless } from "../src/runtime/headless.ts";
import { failing, passing, plan, setup } from "./agency.ts";

const brief = "Add a pricing card to the landing page.";

function project(): string {
  const folder = mkdtempSync(join(tmpdir(), "amora-run-"));
  writeFileSync(join(folder, "package.json"), "{}");
  return folder;
}

async function run(
  script: Parameters<typeof setup>[0],
  flags: { approve?: boolean; complete?: boolean; budgetUsd?: number; dailyUsd?: number } = {},
) {
  const world = setup(script, flags.dailyUsd === undefined ? {} : { dailyUsd: flags.dailyUsd });
  const lines: string[] = [];
  const options = {
    brief,
    budgetUsd: flags.budgetUsd ?? 1,
    project: project(),
    approve: flags.approve ?? false,
    complete: flags.complete ?? false,
  };
  const result = await runHeadless(world.runtime, world.storage, options, (line) =>
    lines.push(line),
  );
  return { ...result, lines };
}

const works = () => ({
  plan_v1: [plan(["builder"])],
  note_v1: [{ text: "v" }],
  review_v1: [passing],
});

describe("amora run, without the dashboard", () => {
  it("plans and stops for approval by default", async () => {
    const result = await run(works());
    assert.equal(result.code, 0);
    assert.equal(result.task?.status, "awaiting_plan_approval");
    assert.match(result.report, /^The plan is ready for approval\. .*--approve/);
    assert.deepEqual(result.lines, [
      `You: ${brief}`,
      "AMORA: The plan is ready for your approval.",
    ]);
  });

  it("runs every step with --approve, and delivers with --complete", async () => {
    const ran = await run(works(), { approve: true, dailyUsd: 5 });
    assert.equal(ran.code, 0);
    assert.match(ran.report, /^Every step passed its gate\. .*--complete/);
    const completed = await run(works(), { approve: true, complete: true, dailyUsd: 5 });
    assert.equal(completed.code, 0);
    assert.equal(completed.task?.status, "completed");
    assert.equal(completed.report, "The task is complete.");
  });

  it("answers 1 when it is refused or the work stops for a decision", async () => {
    const noLimit = await run(works(), { approve: true });
    assert.equal(noLimit.code, 1);
    assert.match(noLimit.report, /Set a daily budget/);
    const noBudget = await run(works(), { budgetUsd: 0 });
    assert.deepEqual([noBudget.code, noBudget.task], [1, undefined]);
    const stopped = await run(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }], review_v1: [failing("No.")] },
      { approve: true, complete: true, dailyUsd: 5 },
    );
    assert.equal(stopped.code, 1);
    assert.match(stopped.report, /did not pass its gate/);
  });

  it("answers 3 with the time when a provider is out of quota", async () => {
    // A short Retry-After: the runner honours it between retries.
    const quota = Array.from({ length: 3 }, () => new GatewayError(429, "Rate limit", 30));
    const paused = await run(
      { plan_v1: [plan(["builder"])], note_v1: [...quota, { text: "v" }], review_v1: [passing] },
      { approve: true, dailyUsd: 5 },
    );
    assert.equal(paused.code, 3);
    assert.match(paused.report, /^Paused until \d{4}-/);
  });
});

describe("CLI: amora run", () => {
  const cli = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
  const call = (args: string[]) => {
    const home = mkdtempSync(join(tmpdir(), "amora-home-"));
    try {
      const out = execFileSync("node", [cli, ...args], {
        env: { ...process.env, AMORA_HOME: home },
        encoding: "utf8",
        stdio: "pipe",
      });
      return { code: 0, out };
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string };
      return { code: failed.status, out: `${failed.stdout}${failed.stderr}` };
    }
  };

  it("needs a brief and a project before it calls any model", () => {
    const noBrief = call(["run"]);
    assert.equal(noBrief.code, 1);
    assert.match(noBrief.out, /run "<brief>"/);
    const noProject = call(["run", brief, "--approve", "--json"]);
    assert.equal(noProject.code, 1);
    assert.match(noProject.out, /Set the project first/);
  });
});
