import { unmetRequirements } from "../model-layer/capabilities.ts";
import { comboOf, probedCapabilities, probeMaxAgeDays } from "../model-layer/known-models.ts";
import {
  assignModel,
  resolveWorker,
  type Resolution,
  type SlotLevel,
  unassignModel,
} from "../model-layer/slots.ts";
import { divisions, type WorkerManifest } from "../runtime/manifest-schema.ts";
import { dayMs } from "../runtime/time.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";
import { probeModel } from "./probe.ts";

// Labels from PRD §7.4. Evals arrive later, so nothing is Verified yet: a
// probed model that fits is Experimental, and an unprobed one is Unverified.
const labels: Record<Resolution["verdict"], string> = {
  fits: "Experimental",
  unprobed: "Unverified",
  rejected: "Rejected",
  unassigned: "",
};

// How old the measurement behind a model is, so a stale one is visible
// instead of trusted.
function probeNote(context: AppContext, model: string | undefined): string {
  if (!model) return "";
  const probed = probedCapabilities(context.storage, model);
  if (!probed) return context.lookup(model) ? "  from the registry" : "";
  const days = Math.floor((Date.now() - Date.parse(probed.probedAt)) / dayMs);
  const age = days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
  return `  probed ${age}${days > probeMaxAgeDays ? " (stale)" : ""}`;
}

export function listModels(context: AppContext): void {
  if (context.manifests.length === 0) return print("No worker manifests found.");
  for (const manifest of context.manifests) {
    const resolution = resolveWorker(manifest, context.slots, context.lookup);
    const model = resolution.model ? `${resolution.model} (${resolution.level})` : "no model";
    const note = probeNote(context, resolution.model);
    print(`${manifest.id}  ${model}  ${labels[resolution.verdict]}${note}`.trimEnd());
    for (const problem of resolution.problems) print(`  ${problem}`);
  }
}

function parseTarget(scope: string): { level: SlotLevel; key?: string } | undefined {
  if (scope === "global") return { level: "global" };
  const [level, key] = scope.split(":");
  if (level === "division" && divisions.includes(key as (typeof divisions)[number])) {
    return { level, key: key as string };
  }
  if (level === "worker" && key) return { level, key };
  return undefined;
}

// A combo is refused when any member falls short, so name the members. The
// combo's own context figure stands in for each member's, because a gateway
// often knows the combo's but not every member's.
function explainCombo(context: AppContext, model: string, manifest: WorkerManifest): void {
  const combo = comboOf(context.storage, model);
  if (!combo) return;
  printError("A combo can only do what every one of its members can do. Members that fall short:");
  for (const member of combo.members) {
    const capabilities = probedCapabilities(context.storage, member)?.capabilities;
    if (!capabilities) {
      printError(`  ${member}: not probed yet`);
      continue;
    }
    const asInCombo = { ...capabilities, context: combo.contextLength ?? capabilities.context };
    for (const problem of unmetRequirements(manifest.requires, asInCombo, manifest.role)) {
      printError(`  ${member}: ${problem}`);
    }
  }
}

export async function setModel(
  context: AppContext,
  scope: string,
  model: string,
  allowDataCollection: boolean,
): Promise<boolean> {
  const target = parseTarget(scope);
  if (!target) {
    printError("Scope must be global, division:<name>, or worker:<id>.");
    return false;
  }
  // A model is probed when it is added (PRD §7.6). One the registry already
  // describes carries measurements, and one probed here before is not repeated.
  if (!context.lookup(model) && !(await probeModel(context, model, allowDataCollection))) {
    return false;
  }
  const manifest = context.manifests.find((candidate) => candidate.id === target.key);
  const expires = context.registry.models.find((entry) => entry.model === model)?.expires;
  const outcome = assignModel(context.slots, target, model, {
    ...(manifest ? { manifest } : {}),
    lookup: context.lookup,
    ...(expires ? { expires } : {}),
  });
  if ("problems" in outcome) {
    for (const problem of outcome.problems) printError(problem);
    if (manifest) explainCombo(context, model, manifest);
    return false;
  }
  context.storage.setSetting("slots", outcome.config);
  print(`${scope} now uses ${model}.`);
  return true;
}

export function unsetModel(context: AppContext, scope: string): boolean {
  const target = parseTarget(scope);
  if (!target) {
    printError("Scope must be global, division:<name>, or worker:<id>.");
    return false;
  }
  const manifest = context.manifests.find((candidate) => candidate.id === target.key);
  const outcome = unassignModel(context.slots, target, manifest);
  if ("problems" in outcome) {
    for (const problem of outcome.problems) printError(problem);
    return false;
  }
  context.storage.setSetting("slots", outcome.config);
  print(`${scope} no longer has a model of its own (it was ${outcome.removed}).`);
  return true;
}

// The different-family rule (PRD §6.3) needs every model's base family. The
// registry states it for the models it lists; for others the owner does, from
// the model card, because a derived model carries its base model's family.
export function setFamily(context: AppContext, model: string, family: string): boolean {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(family)) {
    printError(`"${family}" is not a family name; use lowercase, such as claude, gemini, or qwen.`);
    return false;
  }
  const listed = context.registry.models.find((entry) => entry.model === model);
  if (listed) {
    printError(`The registry already says ${model} is ${listed.base_family}; that one is used.`);
    return false;
  }
  if (comboOf(context.storage, model)) {
    printError(`${model} is a combo; set the family of each member instead.`);
    return false;
  }
  const families = context.storage.getSetting<Record<string, string>>("families") ?? {};
  context.storage.setSetting("families", { ...families, [model]: family });
  print(`${model} is now in the ${family} family, for the different-family rule.`);
  return true;
}
