import type { Division, WorkerManifest } from "../runtime/manifest-schema.ts";
import { unmetRequirements } from "./capabilities.ts";
import type { CapabilityLookup } from "./known-models.ts";

// Workers name a slot, never a model. A slot resolves from the global default,
// then a division override, then a worker override (PRD §7.1).
export type SlotConfig = {
  global?: string;
  divisions: Partial<Record<Division, string>>;
  workers: Record<string, string>;
};

export type SlotLevel = "worker" | "division" | "global";

export type Resolution = {
  worker: string;
  model?: string;
  level?: SlotLevel;
  verdict: "fits" | "unassigned" | "unprobed" | "rejected";
  problems: string[];
};

export const emptySlots: SlotConfig = { divisions: {}, workers: {} };

// Every model some level of the configuration points at, once each: the
// models that are in use and so worth keeping probed.
export function assignedModels(config: SlotConfig): string[] {
  const models = [
    config.global,
    ...Object.values(config.divisions),
    ...Object.values(config.workers),
  ];
  return [...new Set(models.filter((model): model is string => model !== undefined))];
}

function configuredModel(manifest: WorkerManifest, config: SlotConfig) {
  const worker = config.workers[manifest.model_slot];
  if (worker) return { model: worker, level: "worker" as const };
  const division = config.divisions[manifest.division];
  if (division) return { model: division, level: "division" as const };
  if (config.global) return { model: config.global, level: "global" as const };
  return undefined;
}

// The most specific configured model is the one the worker gets. If it does
// not meet the worker's requirements, the worker is left without a model and
// the reason is reported, instead of quietly falling back to another level
// (PRD §7.3: AMORA never silently assigns a model that fails a requirement).
export function resolveWorker(
  manifest: WorkerManifest,
  config: SlotConfig,
  lookup: CapabilityLookup,
): Resolution {
  const worker = manifest.id;
  const configured = configuredModel(manifest, config);
  if (!configured) return { worker, verdict: "unassigned", problems: ["No model is assigned."] };
  const capabilities = lookup(configured.model);
  if (!capabilities) {
    const problems = [`${configured.model} has not been probed yet.`];
    return { worker, ...configured, verdict: "unprobed", problems };
  }
  const problems = unmetRequirements(manifest.requires, capabilities, manifest.role);
  return { worker, ...configured, verdict: problems.length > 0 ? "rejected" : "fits", problems };
}

// A worker override is refused outright when the model does not fit, because
// it names exactly one worker. Division and global defaults are accepted,
// and resolveWorker reports the workers they do not fit.
export function assignModel(
  config: SlotConfig,
  target: { level: SlotLevel; key?: string },
  model: string,
  check: { manifest?: WorkerManifest; lookup: CapabilityLookup; expires?: string | null },
): { config: SlotConfig } | { problems: string[] } {
  if (target.level === "global") {
    // The global default is what every worker falls back to, so it has to
    // outlive the next release (PRD §7.5).
    if (check.expires) {
      const reason = `${model} expires on ${check.expires}, and a model that expires cannot be the global default.`;
      return { problems: [reason, "Use a division or worker override for it instead."] };
    }
    return { config: { ...config, global: model } };
  }
  if (target.level === "division") {
    const division = target.key as Division;
    return { config: { ...config, divisions: { ...config.divisions, [division]: model } } };
  }
  const manifest = check.manifest;
  if (!manifest) return { problems: [`No worker is named "${target.key ?? ""}".`] };
  const capabilities = check.lookup(model);
  if (!capabilities) return { problems: [`${model} has not been probed yet.`] };
  const problems = unmetRequirements(manifest.requires, capabilities, manifest.role);
  if (problems.length > 0) return { problems };
  return { config: { ...config, workers: { ...config.workers, [manifest.model_slot]: model } } };
}

// Removes one assignment, so that level falls back to the one above it. When
// there is nothing to remove it says so, instead of reporting a change that
// did not happen.
export function unassignModel(
  config: SlotConfig,
  target: { level: SlotLevel; key?: string },
  manifest?: WorkerManifest,
): { config: SlotConfig; removed: string } | { problems: string[] } {
  if (target.level === "global") {
    const { global: removed, ...rest } = config;
    return removed ? { config: rest, removed } : { problems: ["No global model is assigned."] };
  }
  if (target.level === "division") {
    const division = target.key as Division;
    const removed = config.divisions[division];
    if (!removed) return { problems: [`${division} has no model of its own.`] };
    const divisions = { ...config.divisions };
    delete divisions[division];
    return { config: { ...config, divisions }, removed };
  }
  if (!manifest) return { problems: [`No worker is named "${target.key ?? ""}".`] };
  const removed = config.workers[manifest.model_slot];
  if (!removed) return { problems: [`${manifest.role} has no model of its own.`] };
  const workers = { ...config.workers };
  delete workers[manifest.model_slot];
  return { config: { ...config, workers }, removed };
}
