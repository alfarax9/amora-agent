import type { Logger } from "../runtime/logger.ts";
import type { Storage } from "../runtime/storage.ts";
import { dayMs } from "../runtime/time.ts";
import { saveProbeResults, staleProbes } from "./known-models.ts";
import { OpenRouterError, type OpenRouter } from "./openrouter.ts";
import { runProbes } from "./probes.ts";
import { assignedModels, emptySlots, type SlotConfig } from "./slots.ts";

type Reprobe = {
  storage: Storage;
  openRouter: OpenRouter;
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
  openRouter,
  models,
  logger,
  now,
}: Reprobe): Promise<string[]> {
  const refreshed: string[] = [];
  for (const model of staleProbes(storage, models, now)) {
    try {
      const info = await openRouter.model(model);
      const results = await runProbes(openRouter.chat, model, info?.context_length ?? 0);
      saveProbeResults(storage, model, results);
      logger.info("Model re-probed", { model });
      refreshed.push(model);
    } catch (error) {
      const needsConsent = error instanceof OpenRouterError && error.dataPolicy;
      const reason = needsConsent
        ? "needs data collection allowed: run amora models probe with --allow-data-collection"
        : String(error);
      logger.warn("Model re-probe skipped", { model, reason });
    }
  }
  return refreshed;
}

type Schedule = {
  storage: Storage;
  openRouterFor: () => Promise<OpenRouter | undefined>;
  logger: Logger;
};

// Models in use are measured again once their last probe has aged (PRD §7.6):
// at start, then daily while AMORA runs. The slots are read each time, because
// `amora models set` may have changed them from another terminal, and a failed
// check is logged and tried again the next day. Returns the way to stop it.
export function scheduleReprobes({ storage, openRouterFor, logger }: Schedule): () => void {
  const check = async () => {
    const openRouter = await openRouterFor();
    if (!openRouter) return;
    const slots = storage.getSetting<SlotConfig>("slots") ?? emptySlots;
    await reprobeStale({ storage, openRouter, models: assignedModels(slots), logger });
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
