import { readFileSync } from "node:fs";
import { join } from "node:path";
import { familyLookup } from "../model-layer/families.ts";
import { parseModelId } from "../model-layer/gateway.ts";
import { createOpenRouter } from "../model-layer/openrouter.ts";
import { emptySlots, type SlotConfig } from "../model-layer/slots.ts";
import type { Agency } from "../runtime/agency.ts";
import type { Price } from "../runtime/estimate.ts";
import { chooseRoster } from "../runtime/roster.ts";
import { dataDirectory } from "../runtime/storage.ts";
import { type AppContext, packageRoot } from "./context.ts";
import { omniRouteClient } from "./measure.ts";
import { rosterProfile } from "./profile.ts";
import { priceOf } from "./prices.ts";
import { openRouterDataCollection } from "./privacy.ts";

// Real work goes through the gateway each slot names. OpenRouter requests deny
// data collection (S10) unless the owner allowed it with amora privacy: a task
// carries the owner's project, unlike a probe's fixed test prompts.
// A worker's answer can be whole files from a reasoning model, minutes long, so
// work replies stream and the wait is on silence (stream.ts): a fixed 300 s
// cut off answers that were still arriving.
const workStream = { idleMs: 180_000, totalMs: 1_800_000 };

async function connect(context: AppContext, model: string) {
  const { gateway, name } = parseModelId(model);
  if (gateway === "omniroute") {
    return { chat: (await omniRouteClient(context, { stream: workStream })).chat, name };
  }
  const key = await context.secrets.get("openrouter");
  if (!key) throw new Error("Connect OpenRouter first: run amora and choose Connect OpenRouter.");
  const dataCollection = openRouterDataCollection(context);
  return {
    chat: createOpenRouter(key, { dataCollection, stream: workStream }).chat,
    name,
  };
}

export function agencyFor(context: AppContext): Agency {
  const { storage } = context;
  const prices = new Map<string, Promise<Price | undefined>>();
  return {
    storage,
    manifests: context.manifests,
    contracts: context.contracts,
    readPrompt: (manifest) => readFileSync(join(packageRoot, manifest.prompt), "utf8"),
    // Read on every turn, so `amora models set` in another terminal applies to
    // the next step without a restart.
    slots: () => storage.getSetting<SlotConfig>("slots") ?? emptySlots,
    lookup: context.lookup,
    families: familyLookup(storage, context.registry),
    connect: (model) => connect(context, model),
    workspaces: join(dataDirectory(), "workspaces"),
    backups: join(dataDirectory(), "backups"),
    // Read when a plan is drafted, so `amora team` applies to the next task.
    roster: (brief) => chooseRoster(rosterProfile(context), brief),
    // Looked up once per model in this process; OpenRouter's list is large.
    price: (model) => {
      const cached = prices.get(model) ?? priceOf(context, model);
      prices.set(model, cached);
      return cached;
    },
  };
}
