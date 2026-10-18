import { resolveWorker } from "../model-layer/slots.ts";
import type { Agency } from "./agency.ts";
import type { PlanStep, Estimate } from "./task-store.ts";

// What a plan should cost, worked out by code (PRD §4 step 4): one call per
// step, one more for each reviewer its gate names, each of a typical size,
// at the price of the model the slot gives that worker. Repairs and retries
// cost more; the task's budget still stops them.

export type Price = { inputPerMillion: number; outputPerMillion: number };

// A worker's call carries the brief, the earlier steps' output, and the
// project's files in its area; its answer is a few files at most.
const typicalCall = { inputTokens: 12_000, outputTokens: 4_000 };

function reviewersOf(agency: Agency, workerId: string): string[] {
  const manifest = agency.manifests.find(({ id }) => id === workerId);
  return (manifest?.quality_gate ?? []).flatMap((check) =>
    typeof check === "object" && "reviewed_by" in check ? [String(check.reviewed_by)] : [],
  );
}

function modelOf(agency: Agency, workerId: string): string | undefined {
  const manifest = agency.manifests.find(({ id }) => id === workerId);
  if (!manifest) return undefined;
  const resolution = resolveWorker(manifest, agency.slots(), agency.lookup);
  return resolution.verdict === "fits" ? resolution.model : undefined;
}

export async function estimatePlan(agency: Agency, steps: PlanStep[]): Promise<Estimate> {
  const workers = steps.flatMap(({ worker }) => [worker, ...reviewersOf(agency, worker)]);
  let usd = 0;
  const unpriced = new Set<string>();
  for (const worker of workers) {
    const model = modelOf(agency, worker);
    const price = model ? await agency.price(model) : undefined;
    if (!model || !price) {
      unpriced.add(model ?? `${worker} (no model that fits)`);
      continue;
    }
    usd += (typicalCall.inputTokens * price.inputPerMillion) / 1e6;
    usd += (typicalCall.outputTokens * price.outputPerMillion) / 1e6;
  }
  // Prices per token are tiny fractions; a millionth of a dollar is plenty.
  return { usd: Math.round(usd * 1e6) / 1e6, unpriced: [...unpriced] };
}
