import {
  type ProbeResult,
  probedCapabilities,
  probeMaxAgeDays,
  saveProbeResults,
} from "../model-layer/known-models.ts";
import { createOpenRouter, OpenRouterError, type OpenRouter } from "../model-layer/openrouter.ts";
import { runProbes } from "../model-layer/probes.ts";
import {
  assignedModels,
  assignModel,
  resolveWorker,
  type Resolution,
  type SlotLevel,
  unassignModel,
} from "../model-layer/slots.ts";
import { divisions } from "../runtime/manifest-schema.ts";
import { dayMs } from "../runtime/time.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

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

function dataPolicyHelp(wasAllowed: boolean): string {
  const settings =
    "OpenRouter must also allow free endpoints that may train on inputs: https://openrouter.ai/settings/privacy";
  if (wasAllowed)
    return `Even with data collection allowed, OpenRouter found no provider for that model. ${settings}`;
  return [
    "That model has no provider that keeps your prompts private, and AMORA denies data collection by default (S10).",
    "A probe sends only fixed test prompts (2 + 3, and a red square), never your project, so you can allow it for one run:",
    "  amora models probe <model> --allow-data-collection",
    settings,
  ].join("\n");
}

// A refusal because of the data policy says nothing about the model, so it is
// explained here and nothing is stored; other failures go to the caller.
async function measure(
  openRouter: OpenRouter,
  model: string,
  contextLength: number,
  wasAllowed: boolean,
): Promise<ProbeResult[] | undefined> {
  try {
    return await runProbes(openRouter.chat, model, contextLength, {
      onRetry: (status, delayMs) =>
        print(`  The provider is busy (${status}); trying again in ${delayMs / 1000} s.`),
    });
  } catch (error) {
    if (!(error instanceof OpenRouterError) || !error.dataPolicy) throw error;
    printError(dataPolicyHelp(wasAllowed));
    return undefined;
  }
}

export async function probeModel(
  context: AppContext,
  model: string,
  allowDataCollection: boolean,
): Promise<boolean> {
  const key = await context.secrets.get("openrouter");
  if (!key) {
    printError("Connect OpenRouter first: run amora and choose Connect OpenRouter.");
    return false;
  }
  const dataCollection = allowDataCollection ? "allow" : "deny";
  const openRouter = createOpenRouter(key, { dataCollection });
  if (allowDataCollection) {
    print(
      "Data collection is allowed for this probe only. It sends fixed test prompts, no project data.",
    );
  }
  const info = await openRouter.model(model);
  if (!info) return (printError(`OpenRouter has no model called ${model}.`), false);
  print(`Probing ${model}. This sends a few short requests, billed to your OpenRouter account.`);
  const results = await measure(openRouter, model, info.context_length ?? 0, allowDataCollection);
  if (!results) return false;
  saveProbeResults(context.storage, model, results);
  for (const { capability, result, detail } of results)
    print(`  ${capability}: ${result} (${detail})`);
  return true;
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

// Measures every model in use again, whatever its age.
export async function probeAssigned(
  context: AppContext,
  allowDataCollection: boolean,
): Promise<boolean> {
  const models = assignedModels(context.slots);
  if (models.length === 0) {
    print("No models are assigned yet.");
    return true;
  }
  let allProbed = true;
  for (const model of models) {
    allProbed = (await probeModel(context, model, allowDataCollection)) && allProbed;
  }
  return allProbed;
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
