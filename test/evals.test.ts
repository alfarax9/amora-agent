import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runAcceptance } from "../src/evals/acceptance.ts";
import { loadSuite } from "../src/evals/suite.ts";

import { benchmark, root, suite, taxSolution, taxWrong } from "./eval-fixture.ts";

describe("benchmark set", () => {
  it("ships fifteen briefs on two projects, most of them held out", () => {
    assert.deepEqual(suite.errors, []);
    assert.equal(suite.items.length, 15);
    assert.equal(new Set(suite.items.map(({ project }) => project)).size, 2);
    assert.equal(suite.items.filter(({ heldOut }) => heldOut).length, 13);
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
    assert.equal(items.length, 11);
    assert.ok(errors.includes("evals/briefs/faq: acceptance.test.mjs is missing"));
    assert.ok(errors.includes('evals/briefs/pricing: id is "prices" but the folder is pricing'));
    assert.ok(
      errors.some((error) => error.startsWith("evals/briefs/tax: / must have required property")),
    );
    assert.ok(errors.includes("evals/briefs/summary: project nowhere has no package.json"));
  });
});

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
