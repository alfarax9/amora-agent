import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownReport, summarize } from "../src/evals/report.ts";
import type { EvalRow } from "../src/evals/run.ts";

describe("benchmark report", () => {
  const row = (system: "amora" | "baseline", success: boolean, heldOut: boolean): EvalRow => ({
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
      row("amora", true, false),
      row("amora", false, true),
      row("baseline", false, true),
    ];
    const [amora, baseline] = summarize(rows);
    assert.deepEqual(
      [amora?.successes, amora?.tasks, amora?.heldOutSuccesses, amora?.heldOutTasks, amora?.tokens],
      [1, 2, 0, 1, 300],
    );
    assert.ok(Math.abs((amora?.costPerSuccessUsd ?? 0) - 0.04) < 1e-9);
    assert.equal(baseline?.costPerSuccessUsd, null);
    const markdown = markdownReport(rows, summarize(rows), "Run");
    assert.match(
      markdown,
      /\| amora \| 1 of 2 \| 0 of 1 \| 4 \| 300 \| \$0\.0400 \| \$0\.0400 \| 300 \| 20 s \|/,
    );
    assert.match(markdown, /\| baseline \| 0 of 1 \| 0 of 1 \|.*\| n\/a \| n\/a \|/);
    assert.match(markdown, /Done \\\| fine/);
  });
});
