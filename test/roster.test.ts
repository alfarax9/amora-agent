import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadContracts } from "../src/runtime/contracts.ts";
import { loadManifests } from "../src/runtime/manifests.ts";
import { rosterProblems } from "../src/runtime/roster.ts";
import { manifest } from "./agency.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const contracts = loadContracts(join(root, "contracts")).items;
const workers = loadManifests(join(root, "workers")).items;

describe("roster", () => {
  it("ships nine thin-path workers whose contracts, prompts, and reviewers all exist", () => {
    const problems = rosterProblems(workers, contracts, (path) => existsSync(join(root, path)));
    assert.deepEqual(problems, []);
    assert.deepEqual(workers.map(({ id }) => id).sort(), [
      "fe-api-integration",
      "fe-logic-developer",
      "fe-performance",
      "fe-slice-engineer",
      "planner-decomposer",
      "product-manager",
      "reality-checker",
      "unit-integration-tester",
      "ux-architect",
    ]);
  });

  it("makes the Reality Checker review on a different model family", () => {
    const checker = workers.find(({ id }) => id === "reality-checker");
    assert.equal(checker?.requires.reviewer_family_rule, "different");
    const reviewed = workers.filter(({ quality_gate }) =>
      quality_gate.some((check) => typeof check === "object" && "reviewed_by" in check),
    );
    assert.equal(reviewed.length, 5);
  });

  it("names each broken reference with its manifest", () => {
    const broken = [
      manifest("planner-decomposer", { output_contract: "plan.v1" }),
      manifest("a", { output_contract: "missing.v1" }),
      manifest("b", { prompt: "prompts/none.md" }),
      manifest("c", { quality_gate: ["schema_valid", "lint_pass"] }),
      manifest("d", { quality_gate: [{ reviewed_by: "ghost" }] }),
      manifest("e", { quality_gate: [{ reviewed_by: "a" }] }),
    ];
    const problems = rosterProblems(broken, contracts, (path) => path !== "prompts/none.md");
    assert.deepEqual(problems, [
      "workers/nexus/a.yaml: contract missing.v1 is not in contracts/",
      "workers/nexus/b.yaml: contract note.v1 is not in contracts/",
      "workers/nexus/b.yaml: prompt prompts/none.md does not exist",
      "workers/nexus/c.yaml: contract note.v1 is not in contracts/",
      'workers/nexus/c.yaml: quality_gate has an unknown check "lint_pass"',
      "workers/nexus/d.yaml: contract note.v1 is not in contracts/",
      'workers/nexus/d.yaml: reviewed_by names "ghost", which is not a worker',
      "workers/nexus/e.yaml: contract note.v1 is not in contracts/",
      "workers/nexus/e.yaml: reviewed_by names a, which does not return review.v1",
    ]);
  });

  it("requires a Planner / Decomposer", () => {
    const problems = rosterProblems(
      [manifest("a", { output_contract: "plan.v1" })],
      contracts,
      () => true,
    );
    assert.match(problems.at(-1) ?? "", /No planner-decomposer manifest/);
  });
});
