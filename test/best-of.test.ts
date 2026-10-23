import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMeter, bestOf } from "../src/evals/best-of.ts";
import { emptyMeter } from "../src/evals/meter.ts";
import { fakeAgency, runWith, taxSolution } from "./eval-fixture.ts";

const attempt = (name: string, delivered: boolean, costUsd: number) => ({
  delivered,
  reason: name,
  project: `/${name}`,
  meter: { ...emptyMeter(), costUsd },
});

describe("best of parallel attempts", () => {
  it("keeps the attempt whose gates passed, the cheaper when both did", () => {
    assert.equal(bestOf([attempt("a", false, 0), attempt("b", true, 2)]).reason, "b");
    assert.equal(bestOf([attempt("a", true, 3), attempt("b", true, 2)]).reason, "b");
    assert.equal(bestOf([attempt("a", false, 1), attempt("b", false, 2)]).reason, "a");
    assert.throws(() => bestOf([]));
  });

  it("adds up both attempts' calls, tokens, and cost", () => {
    const total = emptyMeter();
    addMeter(total, { calls: 2, tokensIn: 10, tokensOut: 1, costUsd: 0.5 });
    addMeter(total, { calls: 3, tokensIn: 5, tokensOut: 2, costUsd: 0.25 });
    assert.deepEqual(total, { calls: 5, tokensIn: 15, tokensOut: 3, costUsd: 0.75 });
  });

  it("runs a brief twice at once and scores the attempt it kept", async () => {
    const [row] = await runWith(fakeAgency(taxSolution), ["best-of-2"]);
    assert.equal(row?.success, true);
    // Two Small-team runs: the Planner, the Engineer, and the Tester with their reviews, twice.
    assert.equal(row?.calls, 10);
    assert.match(row?.project ?? "", /attempt-[12][\\/]project$/);
    assert.match(row?.reason ?? "", /\(attempt [12] of 2\)$/);
  });
});
