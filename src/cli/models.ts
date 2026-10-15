import { saveProbeResults } from "../model-layer/known-models.ts";
import { createOpenRouter } from "../model-layer/openrouter.ts";
import { runProbes } from "../model-layer/probes.ts";
import {
  assignModel,
  resolveWorker,
  type Resolution,
  type SlotLevel,
} from "../model-layer/slots.ts";
import { divisions } from "../runtime/manifest-schema.ts";
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

export function listModels(context: AppContext): void {
  if (context.manifests.length === 0) return print("No worker manifests found.");
  for (const manifest of context.manifests) {
    const resolution = resolveWorker(manifest, context.slots, context.lookup);
    const model = resolution.model ? `${resolution.model} (${resolution.level})` : "no model";
    print(`${manifest.id}  ${model}  ${labels[resolution.verdict]}`.trimEnd());
    for (const problem of resolution.problems) print(`  ${problem}`);
  }
}

export async function probeModel(context: AppContext, model: string): Promise<boolean> {
  const key = await context.secrets.get("openrouter");
  if (!key)
    return (
      printError("Connect OpenRouter first: run amora and choose Connect OpenRouter."),
      false
    );
  const openRouter = createOpenRouter(key);
  const info = await openRouter.model(model);
  if (!info) return (printError(`OpenRouter has no model called ${model}.`), false);
  print(`Probing ${model}. This sends a few short requests, billed to your OpenRouter account.`);
  const results = await runProbes(openRouter.chat, model, info.context_length ?? 0);
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

export function setModel(context: AppContext, scope: string, model: string): boolean {
  const target = parseTarget(scope);
  if (!target) {
    printError("Scope must be global, division:<name>, or worker:<id>.");
    return false;
  }
  const manifest = context.manifests.find((candidate) => candidate.id === target.key);
  const outcome = assignModel(context.slots, target, model, {
    ...(manifest ? { manifest } : {}),
    lookup: context.lookup,
  });
  if ("problems" in outcome) {
    for (const problem of outcome.problems) printError(problem);
    return false;
  }
  context.storage.setSetting("slots", outcome.config);
  print(`${scope} now uses ${model}.`);
  return true;
}
