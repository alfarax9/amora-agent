import type { Contract } from "./contracts.ts";
import type { WorkerManifest } from "./manifest-schema.ts";

// Checks that the workers fit together before any task runs: every contract,
// prompt, and reviewer a manifest names exists, and every gate check is one
// AMORA knows. Each problem names the manifest, so a contributor can fix it
// at load time instead of halfway through a paid task.

export const plannerId = "planner-decomposer";

// What the owner typed. Every other input is something an earlier worker
// delivered.
export const briefContract = "brief.v1";

// Gate checks AMORA knows by name. Some cannot run yet; a gate that reaches one
// stops and asks the owner, but a misspelt name is caught here.
const knownChecks = [
  "schema_valid",
  "reviewed_by",
  "files_in_scope",
  "lint_and_typecheck_pass",
  "tests_pass",
  "visual_diff_below",
  "a11y_score_at_least",
];

function checkName(check: string | Record<string, unknown>): string {
  return typeof check === "string" ? check : (Object.keys(check)[0] ?? "");
}

function reviewerProblems(manifest: WorkerManifest, manifests: WorkerManifest[]): string[] {
  return manifest.quality_gate.flatMap((check) => {
    if (typeof check === "string" || !("reviewed_by" in check)) return [];
    const reviewer = manifests.find(({ id }) => id === check.reviewed_by);
    if (!reviewer) {
      return [`reviewed_by names "${String(check.reviewed_by)}", which is not a worker`];
    }
    if (reviewer.output_contract !== "review.v1") {
      return [`reviewed_by names ${reviewer.id}, which does not return review.v1`];
    }
    return [];
  });
}

function manifestProblems(
  manifest: WorkerManifest,
  manifests: WorkerManifest[],
  contracts: Set<string>,
  promptExists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const contract of [manifest.input_contract, manifest.output_contract]) {
    if (!contracts.has(contract)) problems.push(`contract ${contract} is not in contracts/`);
  }
  for (const prompt of [manifest.prompt, ...Object.values(manifest.prompt_variants ?? {})]) {
    if (!promptExists(prompt)) problems.push(`prompt ${prompt} does not exist`);
  }
  for (const check of manifest.quality_gate) {
    const name = checkName(check);
    if (!knownChecks.includes(name)) problems.push(`quality_gate has an unknown check "${name}"`);
  }
  return [...problems, ...reviewerProblems(manifest, manifests)];
}

export function rosterProblems(
  manifests: WorkerManifest[],
  contracts: Contract[],
  promptExists: (path: string) => boolean,
): string[] {
  const ids = new Set(contracts.map(({ id }) => id));
  const problems = manifests.flatMap((manifest) =>
    manifestProblems(manifest, manifests, ids, promptExists).map(
      (problem) => `workers/${manifest.division}/${manifest.id}.yaml: ${problem}`,
    ),
  );
  if (manifests.length > 0 && !manifests.some(({ id }) => id === plannerId)) {
    problems.push(`No ${plannerId} manifest: every task starts with the Planner / Decomposer.`);
  }
  return problems;
}
