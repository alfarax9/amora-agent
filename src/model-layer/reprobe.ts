import type { Logger } from "../runtime/logger.ts";
import type { Storage } from "../runtime/storage.ts";
import { dayMs } from "../runtime/time.ts";
import { GatewayError } from "./gateway.ts";
import { staleProbes } from "./known-models.ts";
import { assignedModels, emptySlots, type SlotConfig } from "./slots.ts";

// Probes one model (or every member of a combo) and stores the results. The
// caller picks the gateway; this module only decides when.
type Measure = (model: string) => Promise<void>;

type Reprobe = {
  storage: Storage;
  measure: Measure;
  models: string[];
  logger: Logger;
  now?: number;
};

// Measures again the models in use whose last probe has aged (PRD §7.6) and
// returns the ones it refreshed. It never allows data collection: that choice
// is the owner's, made per run, so a model that needs it is reported and left
// as it was. A failure on one model never stops the others.
export async function reprobeStale({
  storage,
  measure,
  models,
  logger,
  now,
}: Reprobe): Promise<string[]> {
  const refreshed: string[] = [];
  for (const model of staleProbes(storage, models, now)) {
    try {
      await measure(model);
      logger.info("Model re-probed", { model });
      refreshed.push(model);
    } catch (error) {
      const needsConsent = error instanceof GatewayError && error.dataPolicy;
      const reason = needsConsent
        ? "needs data collection allowed: run amora models probe with --allow-data-collection"
        : String(error);
      logger.warn("Model re-probe skipped", { model, reason });
    }
  }
  return refreshed;
}

type Schedule = { storage: Storage; measure: Measure; logger: Logger };

// Models in use are measured again once their last probe has aged (PRD §7.6):
// at start, then daily while AMORA runs. The slots are read each time, because
// `amora models set` may have changed them from another terminal, and a failed
// check is logged and tried again the next day. Returns the way to stop it.
export function scheduleReprobes({ storage, measure, logger }: Schedule): () => void {
  const check = async () => {
    const slots = storage.getSetting<SlotConfig>("slots") ?? emptySlots;
    await reprobeStale({ storage, measure, models: assignedModels(slots), logger });
  };
  const run = () =>
    check().catch((error: unknown) =>
      logger.warn("Re-probe check failed", { reason: String(error) }),
    );
  void run();
  const timer = setInterval(run, dayMs);
  timer.unref();
  return () => clearInterval(timer);
}
