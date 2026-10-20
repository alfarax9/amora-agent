import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import type { LoadResult } from "../runtime/manifests.ts";

// The benchmark set (PRD §3, §7.6): briefs on small fixture projects, each with
// a hidden acceptance test that neither AMORA nor the baseline sees, and a
// reference solution that shows the test can be passed. `held_out` marks the
// briefs nobody tuned prompts or code against. The regression tier is small
// and quick, for every change; the realistic tier is a React app with real
// dependencies, multi-file features, vague briefs, and bugs to fix; the heavy
// tier is what the weighed roster sends to the specialists: a small product
// from scratch, and new screens backed by an API.

type Tier = "regression" | "realistic" | "heavy";

export type EvalBrief = {
  id: string;
  brief: string;
  heldOut: boolean;
  tier: Tier;
  // The fixture project the task starts from, and the hidden test.
  project: string;
  acceptance: string;
  solution: string;
};

type BriefFile = { id: string; project: string; held_out: boolean; tier?: Tier; brief: string };

const validate = new Ajv({ allErrors: true }).compile<BriefFile>({
  type: "object",
  properties: {
    id: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
    project: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
    held_out: { type: "boolean" },
    tier: { enum: ["regression", "realistic", "heavy"] },
    brief: { type: "string", minLength: 20 },
  },
  required: ["id", "project", "held_out", "brief"],
  additionalProperties: false,
});

// A fixture with dependencies is checked against them, so they must be there.
function missingPackages(manifest: string): boolean {
  const { dependencies = {}, devDependencies = {} } = JSON.parse(
    readFileSync(manifest, "utf8"),
  ) as {
    dependencies?: object;
    devDependencies?: object;
  };
  const wanted = Object.keys(dependencies).length + Object.keys(devDependencies).length > 0;
  return wanted && !existsSync(join(manifest, "..", "node_modules"));
}

function problemsOf(root: string, folder: string, data: unknown): string[] {
  if (!validate(data)) {
    return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`);
  }
  const problems: string[] = [];
  if (data.id !== folder) problems.push(`id is "${data.id}" but the folder is ${folder}`);
  const manifest = join(root, "projects", data.project, "package.json");
  if (!existsSync(manifest)) problems.push(`project ${data.project} has no package.json`);
  else if (missingPackages(manifest)) {
    problems.push(
      `project ${data.project} needs its packages: npm ci --prefix evals/projects/${data.project}`,
    );
  }
  for (const file of ["acceptance.test.mjs", "solution"]) {
    if (!existsSync(join(root, "briefs", folder, file))) problems.push(`${file} is missing`);
  }
  return problems;
}

export function loadSuite(root: string): LoadResult<EvalBrief> {
  const items: EvalBrief[] = [];
  const errors: string[] = [];
  for (const folder of readdirSync(join(root, "briefs")).sort()) {
    const file = join(root, "briefs", folder, "brief.json");
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      errors.push(`evals/briefs/${folder}/brief.json: ${(error as Error).message}`);
      continue;
    }
    const problems = problemsOf(root, folder, data);
    if (problems.length > 0) {
      errors.push(...problems.map((problem) => `evals/briefs/${folder}: ${problem}`));
      continue;
    }
    const { id, project, held_out: heldOut, tier = "regression", brief } = data as BriefFile;
    const folderPath = join(root, "briefs", folder);
    items.push({
      id,
      brief,
      heldOut,
      tier,
      project: join(root, "projects", project),
      acceptance: join(folderPath, "acceptance.test.mjs"),
      solution: join(folderPath, "solution"),
    });
  }
  return { items, errors };
}
