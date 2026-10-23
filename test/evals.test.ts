import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runAcceptance } from "../src/evals/acceptance.ts";
import { loadSuite } from "../src/evals/suite.ts";

import { benchmark, bothWays, root, suite, taxSolution, taxWrong } from "./eval-fixture.ts";

describe("benchmark set", () => {
  it("ships forty-four briefs on five projects, in three tiers, most of them held out", () => {
    assert.deepEqual(suite.errors, []);
    assert.equal(suite.items.length, 44);
    assert.equal(new Set(suite.items.map(({ project }) => project)).size, 5);
    assert.equal(suite.items.filter(({ heldOut }) => heldOut).length, 42);
    const tiers = suite.items.map(({ tier }) => tier);
    assert.equal(tiers.filter((tier) => tier === "realistic").length, 10);
    assert.equal(tiers.filter((tier) => tier === "heavy").length, 4);
  });

  it("has regression tests that fail on the untouched project and pass with the reference solution", async () => {
    for (const brief of suite.items.filter(({ tier }) => tier === "regression")) {
      const { untouched, solved } = await bothWays(brief);
      assert.ok(untouched.failed > 0, `${brief.id} untouched`);
      assert.equal(solved.failed, 0, `${brief.id} solution: ${solved.output}`);
      assert.ok(solved.passed > 0, brief.id);
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
    // Without the React fixture's installed packages, which its briefs need.
    cpSync(join(root, "evals"), broken, {
      recursive: true,
      filter: (source) => !source.endsWith("node_modules"),
    });
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
    assert.equal(items.length, 26);
    assert.ok(
      errors.includes(
        "evals/briefs/app-add-note: project notes-app needs its packages: npm ci --prefix evals/projects/notes-app",
      ),
    );
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
        ["full", true, true, 0],
        ["small", true, true, 0],
        ["single-agent", true, true, 0],
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
