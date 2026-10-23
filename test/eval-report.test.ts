import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownReport, summarize } from "../src/evals/report.ts";
import type { EvalRow } from "../src/evals/run.ts";

describe("benchmark report", () => {
  const row = (system: "full" | "single-agent", success: boolean, heldOut: boolean): EvalRow => ({
    brief: "b",
    run: 1,
    heldOut,
    system,
    delivered: true,
    reason: "Done | fine",
    passed: success ? 3 : 1,
    failed: success ? 0 : 2,
    success,
    seconds: 10,
    project: "/p",
    calls: 2,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.02,
  });

  it("puts cost per successful task next to the success rate, held out and overall", () => {
    const rows = [
      row("full", true, false),
      row("full", false, true),
      row("single-agent", false, true),
    ];
    const [full, single] = summarize(rows);
    assert.deepEqual(
      [full?.successes, full?.tasks, full?.heldOutSuccesses, full?.heldOutTasks, full?.tokens],
      [1, 2, 0, 1, 300],
    );
    assert.ok(Math.abs((full?.costPerSuccessUsd ?? 0) - 0.04) < 1e-9);
    assert.equal(single?.costPerSuccessUsd, null);
    const markdown = markdownReport(rows, summarize(rows), "Run");
    assert.match(
      markdown,
      /\| full \| 1 of 2 \| 0 of 1 \| 0 of 1 briefs \| 4 \| 300 \| \$0\.0400 \| \$0\.0400 \| 300 \| 20 s \|/,
    );
    assert.match(markdown, /\| single-agent \| 0 of 1 \| 0 of 1 \|.*\| n\/a \| n\/a \|/);
    assert.match(markdown, /Done \\\| fine/);
  });

  it("counts a brief as steady only when it succeeded in every run", () => {
    const rows = [
      { ...row("full", true, true), brief: "a" },
      { ...row("full", true, true), brief: "a", run: 2 },
      { ...row("full", true, true), brief: "b" },
      { ...row("full", false, true), brief: "b", run: 2 },
    ];
    const [full] = summarize(rows);
    assert.deepEqual([full?.steadyBriefs, full?.briefs, full?.successes], [1, 2, 3]);
    assert.match(markdownReport(rows, summarize(rows), "Run"), /\| b \| 2 \| yes \| full \| no \|/);
  });
});
