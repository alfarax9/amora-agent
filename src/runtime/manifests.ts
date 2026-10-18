import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { Ajv } from "ajv";
import { parse } from "yaml";
import { manifestSchema, type WorkerManifest } from "./manifest-schema.ts";

export type LoadResult<T> = { items: T[]; errors: string[] };

const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile<WorkerManifest>(
  manifestSchema,
);

// Reads every manifest under workers/<division>/ and reports all problems at
// once, so a contributor fixes a batch instead of one error per run.
export function loadManifests(root: string): LoadResult<WorkerManifest> {
  const items: WorkerManifest[] = [];
  const errors: string[] = [];
  for (const file of yamlFiles(root)) {
    // Forward slashes on every platform, so messages and tests read the same.
    const name = relative(root, file).split(sep).join("/");
    let data: unknown;
    try {
      data = parse(readFileSync(file, "utf8"));
    } catch (error) {
      // A YAML mistake in one manifest is reported like any other problem,
      // instead of stopping every command that loads the workers.
      errors.push(`${name}: ${(error as Error).message.split("\n")[0] ?? "is not valid YAML"}`);
      continue;
    }
    const problems = checkManifest(data, file);
    if (problems.length > 0) errors.push(...problems.map((problem) => `${name}: ${problem}`));
    else items.push(data as WorkerManifest);
  }
  errors.push(...duplicateIds(items));
  return { items, errors };
}

function checkManifest(data: unknown, file: string): string[] {
  if (!validate(data)) {
    return (validate.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    );
  }
  // The folder is the division, so a manifest moved by hand cannot silently
  // claim a different one.
  const folder = basename(dirname(file));
  return folder === data.division
    ? []
    : [`division is "${data.division}" but the file is in ${folder}/`];
}

function duplicateIds(manifests: WorkerManifest[]): string[] {
  const seen = new Set<string>();
  return manifests.flatMap(({ id }) => {
    if (!seen.has(id)) return (seen.add(id), []);
    return [`worker id "${id}" is used by more than one manifest`];
  });
}

function yamlFiles(root: string): string[] {
  try {
    return readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.ya?ml$/.test(file))
      .sort()
      .map((file) => join(root, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
