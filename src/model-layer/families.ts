import type { Storage } from "../runtime/storage.ts";
import { comboOf } from "./known-models.ts";
import type { Registry } from "./registry.ts";

// A reviewer marked ≠ must use a different model family from the worker it
// reviews (PRD §6.3), so a model's blind spots are not checked by the same
// blind spots. `base_family` comes from the registry; for a model the registry
// does not list, the owner states it (setting "families"), because guessing it
// from a name gets derived models wrong.

export type FamilyLookup = (model: string) => string[] | undefined;

export function familyLookup(storage: Storage, registry: Registry): FamilyLookup {
  const single = (model: string) =>
    registry.models.find((entry) => entry.model === model)?.base_family ??
    storage.getSetting<Record<string, string>>("families")?.[model];
  return (model) => {
    // A combo can answer with any member, so every member's family counts.
    const members = comboOf(storage, model)?.members ?? [model];
    const families = members.map(single);
    if (families.some((family) => family === undefined)) return undefined;
    return [...new Set(families as string[])];
  };
}

type Side = { role: string; model: string };

// Says why the reviewer may not review this work, or nothing when it may. An
// unknown family is a reason too: the rule is enforced, not advised.
export function familyProblem(
  reviewer: Side,
  reviewed: Side,
  lookup: FamilyLookup,
): string | undefined {
  for (const side of [reviewer, reviewed]) {
    if (!lookup(side.model)) {
      return `The model family of ${side.model} (${side.role}) is unknown, so AMORA cannot tell whether ${reviewer.role} uses a different family. State it with: amora models family ${side.model} <family>`;
    }
  }
  const theirs = lookup(reviewed.model) ?? [];
  const shared = (lookup(reviewer.model) ?? []).find((family) => theirs.includes(family));
  if (!shared) return undefined;
  return `${reviewer.role} must use a different model family from ${reviewed.role}, but both use ${shared}.`;
}
