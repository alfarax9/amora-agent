// The worker manifest from PRD §6.1. A typo in a manifest should fail at load
// time with the file and field named, not halfway through a paid task, so
// unknown fields are rejected too.

export const divisions = [
  "forge",
  "atelier",
  "compass",
  "bridge",
  "crucible",
  "bastion",
  "harbor",
  "nexus",
  "ledger",
  "lyceum",
  "atlas",
  "lens",
] as const;

export type Division = (typeof divisions)[number];

type Capability = string | Record<string, unknown>;

export type Requirements = {
  vision: boolean;
  tool_use: boolean;
  structured_output: boolean;
  min_context: number;
  reviewer_family_rule: "none" | "different";
};

export type WorkerManifest = {
  id: string;
  division: Division;
  sub_division?: string;
  wave: 1 | 2 | 3;
  role: string;
  mission: string;
  requires: Requirements;
  model_slot: string;
  prompt: string;
  prompt_variants?: Record<string, string>;
  plugins: Capability[];
  memory: { project: boolean; global_patterns: boolean };
  input_contract: string;
  output_contract: string;
  quality_gate: Capability[];
  permissions: { shell: string[]; network: boolean };
  budget: { max_usd_per_task: number; max_retries: number };
};

const slug = { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" };
const text = { type: "string", minLength: 1 };
const contract = { type: "string", pattern: "^[a-z0-9_]+\\.v[0-9]+$" };
// Capabilities and gate checks are snake_case names (PRD §6.1), either bare
// or as a single-key object carrying options. One schema instead of oneOf
// keeps it to one error per bad entry: pattern only applies to strings and
// the property counts only to objects.
const capability = {
  type: ["string", "object"],
  pattern: "^[a-z0-9]+(_[a-z0-9]+)*$",
  minProperties: 1,
  maxProperties: 1,
};

function strictObject(properties: Record<string, unknown>, optional: string[] = []) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    additionalProperties: false,
  };
}

export const manifestSchema = strictObject(
  {
    id: slug,
    division: { enum: divisions },
    sub_division: slug,
    wave: { enum: [1, 2, 3] },
    role: text,
    mission: text,
    requires: strictObject({
      vision: { type: "boolean" },
      tool_use: { type: "boolean" },
      structured_output: { type: "boolean" },
      min_context: { type: "integer", minimum: 0 },
      reviewer_family_rule: { enum: ["none", "different"] },
    }),
    model_slot: slug,
    prompt: text,
    prompt_variants: { type: "object", additionalProperties: text },
    plugins: { type: "array", items: capability },
    memory: strictObject({ project: { type: "boolean" }, global_patterns: { type: "boolean" } }),
    input_contract: contract,
    output_contract: contract,
    quality_gate: { type: "array", items: capability, minItems: 1 },
    permissions: strictObject({
      shell: { type: "array", items: text },
      network: { type: "boolean" },
    }),
    // Three attempts, then the task comes back to the user (PRD §6.3).
    budget: strictObject({
      max_usd_per_task: { type: "number", exclusiveMinimum: 0 },
      max_retries: { type: "integer", minimum: 0, maximum: 3 },
    }),
  },
  ["sub_division", "prompt_variants"],
);
