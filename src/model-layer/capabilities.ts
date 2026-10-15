import type { Requirements } from "../runtime/manifest-schema.ts";
import type { ModelCapabilities } from "./registry.ts";

// Each failed requirement becomes one sentence the dashboard and CLI can show
// as is, naming both the missing capability and the worker that needs it
// (PRD §7.1).
export function unmetRequirements(
  requires: Requirements,
  capabilities: ModelCapabilities,
  role: string,
): string[] {
  const problems: string[] = [];
  if (requires.vision && !capabilities.vision) {
    problems.push(`This model doesn't support vision, but ${role} requires it.`);
  }
  if (requires.tool_use && !capabilities.tool_use) {
    problems.push(`This model can't call tools, but ${role} requires it.`);
  }
  if (requires.structured_output && capabilities.structured_output !== "json_schema") {
    problems.push(`This model doesn't support strict JSON schema output, but ${role} requires it.`);
  }
  if (capabilities.context < requires.min_context) {
    problems.push(
      `This model's context is ${capabilities.context} tokens, but ${role} needs at least ${requires.min_context}.`,
    );
  }
  return problems;
}
