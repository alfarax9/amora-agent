import { familyLookup } from "../model-layer/families.ts";
import {
  capabilityLookup,
  comboOf,
  probedCapabilities,
  probeMaxAgeDays,
} from "../model-layer/known-models.ts";
import { defaultOmniRouteUrl } from "../model-layer/omniroute.ts";
import { assignedModels, emptySlots, type SlotConfig } from "../model-layer/slots.ts";
import type { WorkerManifest } from "./manifest-schema.ts";
import { priceOrNothing, type ReportDesk } from "./report-routes.ts";
import { maskSecret } from "./secret-scanner.ts";
import type { Storage } from "./storage.ts";
import { dayMs } from "./time.ts";

// The Models page: the gateways with their keys masked to the last four
// characters, and every model a slot points at, with what each probe measured
// and when, what the registry says about it, and its price.

async function gateways(desk: ReportDesk) {
  const openRouter = await desk.secrets.get("openrouter");
  const omniRoute = await desk.secrets.get("omniroute");
  const url = desk.storage.getSetting<{ url: string }>("omniroute")?.url ?? defaultOmniRouteUrl;
  return [
    { name: "OpenRouter", key: openRouter ? maskSecret(openRouter) : null },
    { name: "OmniRoute", key: omniRoute ? maskSecret(omniRoute) : null, url },
  ];
}

// Where each model is assigned, in words the page shows as is.
function assignments(slots: SlotConfig, manifests: WorkerManifest[]): Map<string, string[]> {
  const places = new Map<string, string[]>();
  const add = (model: string, place: string) =>
    places.set(model, [...(places.get(model) ?? []), place]);
  if (slots.global) add(slots.global, "Global default");
  for (const [division, model] of Object.entries(slots.divisions)) {
    if (model) add(model, `Division ${division}`);
  }
  for (const [slot, model] of Object.entries(slots.workers)) {
    const roles = manifests.filter((manifest) => manifest.model_slot === slot);
    for (const role of roles.length > 0 ? roles.map((manifest) => manifest.role) : [slot]) {
      add(model, role);
    }
  }
  return places;
}

type ProbeRow = { capability: string; result: string; detail: string; probed_at: string };

function probes(storage: Storage, model: string) {
  const rows = storage.database
    .prepare(
      "SELECT capability, result, detail, probed_at FROM model_probes WHERE model = ? ORDER BY capability",
    )
    .all(model) as ProbeRow[];
  return rows.map((row) => ({
    capability: row.capability,
    result: row.result,
    detail: row.detail,
    probedAt: row.probed_at,
  }));
}

function registryEntry(desk: ReportDesk, model: string) {
  const entry = desk.registry.models.find((candidate) => candidate.model === model);
  if (!entry) return null;
  const { license, base_family: baseFamily, expires, probe_date: probeDate } = entry;
  return { license, baseFamily, expires, probeDate, priceSource: entry.pricing.source };
}

async function modelRow(desk: ReportDesk, model: string, places: string[], now: number) {
  const { storage } = desk;
  const probed = probedCapabilities(storage, model);
  const combo = comboOf(storage, model);
  const members = combo?.members ?? [];
  return {
    model,
    assignedTo: places,
    capabilities: capabilityLookup(storage, desk.registry)(model) ?? null,
    probedAt: probed?.probedAt ?? null,
    stale: probed ? now - Date.parse(probed.probedAt) > probeMaxAgeDays * dayMs : false,
    probes: combo ? [] : probes(storage, model),
    combo: combo
      ? {
          strategy: combo.strategy,
          members: members.map((member) => ({ model: member, probes: probes(storage, member) })),
        }
      : null,
    registry: registryEntry(desk, model),
    family: familyLookup(storage, desk.registry)(model) ?? null,
    price: await priceOrNothing(desk, model),
  };
}

export async function modelReport(desk: ReportDesk) {
  const slots = desk.storage.getSetting<SlotConfig>("slots") ?? emptySlots;
  const places = assignments(slots, desk.manifests);
  const now = Date.now();
  const models = await Promise.all(
    assignedModels(slots).map((model) => modelRow(desk, model, places.get(model) ?? [], now)),
  );
  return { gateways: await gateways(desk), probeMaxAgeDays, models };
}
