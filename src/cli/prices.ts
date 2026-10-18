import { parseModelId } from "../model-layer/gateway.ts";
import { comboOf } from "../model-layer/known-models.ts";
import { createOpenRouter } from "../model-layer/openrouter.ts";
import type { Price } from "../runtime/estimate.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

// Where a model's price comes from, first match wins: what the owner stated,
// the registry, OpenRouter's ":free" naming, then OpenRouter's own price list.
// Nothing is guessed: a model none of these know has no price, and a plan that
// needs it waits for the owner to state one.

type Prices = Record<string, Price>;

const free: Price = { inputPerMillion: 0, outputPerMillion: 0 };

async function openRouterPrice(context: AppContext, name: string): Promise<Price | undefined> {
  if (name.endsWith(":free")) return free;
  const key = await context.secrets.get("openrouter");
  if (!key) return undefined;
  const pricing = (await createOpenRouter(key).model(name))?.pricing;
  const input = Number(pricing?.prompt);
  const output = Number(pricing?.completion);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return { inputPerMillion: input * 1e6, outputPerMillion: output * 1e6 };
}

async function singlePrice(context: AppContext, model: string): Promise<Price | undefined> {
  const stated = context.storage.getSetting<Prices>("prices")?.[model];
  if (stated) return stated;
  const listed = context.registry.models.find((entry) => entry.model === model);
  if (listed) {
    const { input, output } = listed.pricing.per_million;
    return { inputPerMillion: input, outputPerMillion: output };
  }
  const { gateway, name } = parseModelId(model);
  return gateway === "openrouter" ? openRouterPrice(context, name) : undefined;
}

// A combo can answer with any member, so it costs what its dearest member does.
export async function priceOf(context: AppContext, model: string): Promise<Price | undefined> {
  const members = comboOf(context.storage, model)?.members ?? [model];
  const prices = await Promise.all(members.map((member) => singlePrice(context, member)));
  if (prices.some((price) => price === undefined)) return undefined;
  const known = prices as Price[];
  return {
    inputPerMillion: Math.max(...known.map((price) => price.inputPerMillion)),
    outputPerMillion: Math.max(...known.map((price) => price.outputPerMillion)),
  };
}

// For models whose price AMORA cannot look up, such as OmniRoute providers on
// a subscription, where 0 is the honest marginal price.
export function setPrice(context: AppContext, model: string, input: string, output: string) {
  const prices = [Number(input), Number(output)];
  if (prices.some((price) => !Number.isFinite(price) || price < 0)) {
    printError("Give the input and output price in USD per million tokens, 0 or more.");
    return false;
  }
  const [inputPerMillion = 0, outputPerMillion = 0] = prices;
  const stated = context.storage.getSetting<Prices>("prices") ?? {};
  context.storage.setSetting("prices", {
    ...stated,
    [model]: { inputPerMillion, outputPerMillion },
  });
  print(`${model} costs $${inputPerMillion} in and $${outputPerMillion} out per million tokens.`);
  return true;
}
