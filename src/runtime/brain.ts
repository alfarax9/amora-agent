import { resolveWorker } from "../model-layer/slots.ts";
import type { Agency } from "./agency.ts";

// A worker's brain as the app shows it: who answers, from which division, on
// which model, and how far that model is trusted. Labels follow PRD §7.4:
// evals arrive later, so a probed model that fits is Experimental and an
// unprobed one is Unverified; nothing is Verified yet.

export type Brain = {
  worker: string;
  role: string;
  division: string;
  model: string;
  label: "Experimental" | "Unverified";
  // The model's base family, for the reviewer rule; unknown for some models.
  family: string | null;
};

type Lookups = Pick<Agency, "manifests" | "slots" | "lookup" | "families">;

export function brainOf(agency: Lookups, workerId: string): Brain | { problem: string } {
  const manifest = agency.manifests.find(({ id }) => id === workerId);
  if (!manifest) return { problem: `No worker is named "${workerId}".` };
  const resolution = resolveWorker(manifest, agency.slots(), agency.lookup);
  const fits = resolution.verdict === "fits" || resolution.verdict === "unprobed";
  if (!fits || !resolution.model) {
    return { problem: `${manifest.role} has no model that fits: ${resolution.problems.join(" ")}` };
  }
  return {
    worker: manifest.id,
    role: manifest.role,
    division: manifest.division,
    model: resolution.model,
    label: resolution.verdict === "fits" ? "Experimental" : "Unverified",
    family: agency.families(resolution.model)?.[0] ?? null,
  };
}
