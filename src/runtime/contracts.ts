import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import type { LoadResult } from "./manifests.ts";

// Every handoff is checked against a JSON Schema contract (PRD §6.2), one file
// per contract in contracts/, named after it: contracts/plan.v1.json.
// Contracts are written so a model's strict JSON schema mode accepts them:
// every property required and no extra properties.

export type Contract = {
  id: string;
  schema: Record<string, unknown>;
  check(value: unknown): string[];
};

function describeErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}

export function loadContracts(root: string): LoadResult<Contract> {
  const ajv = new Ajv({ allErrors: true });
  const items: Contract[] = [];
  const errors: string[] = [];
  const files = readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const file of files) {
    const id = file.slice(0, -".json".length);
    try {
      const schema = JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, unknown>;
      const validate = ajv.compile(schema);
      items.push({
        id,
        schema,
        check: (value) => (validate(value) ? [] : describeErrors(validate)),
      });
    } catch (error) {
      errors.push(`contracts/${file}: ${(error as Error).message}`);
    }
  }
  return { items, errors };
}
