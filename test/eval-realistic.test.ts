import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bothWays, suite } from "./eval-fixture.ts";

// The realistic and heavy tiers build a React app and run Vitest for every
// check, so their briefs are checked three at a time, in a file of their own
// that runs alongside the others.

describe("realistic and heavy benchmark tiers", () => {
  it("has hidden tests that fail on the untouched app and pass with the reference solution", async () => {
    const briefs = suite.items.filter(({ tier }) => tier !== "regression");
    const problems: string[] = [];
    const next = async (): Promise<void> => {
      const brief = briefs.shift();
      if (!brief) return;
      const { untouched, solved } = await bothWays(brief);
      if (untouched.failed === 0) problems.push(`${brief.id} passes untouched`);
      if (solved.failed > 0 || solved.passed === 0) {
        problems.push(`${brief.id} fails with its solution: ${solved.output}`);
      }
      return next();
    };
    await Promise.all([next(), next(), next()]);
    assert.deepEqual(problems, []);
  });
});
