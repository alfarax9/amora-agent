import { omniRouteId, parseModelId } from "../model-layer/gateway.ts";
import { saveCombo, saveProbeResults, type ProbeResult } from "../model-layer/known-models.ts";
import { readCombos } from "../model-layer/omniroute-combos.ts";
import {
  contextOf,
  createOmniRoute,
  defaultOmniRouteUrl,
  type OmniRoute,
  type OmniRouteModel,
} from "../model-layer/omniroute.ts";
import { createOpenRouter } from "../model-layer/openrouter.ts";
import { runProbes } from "../model-layer/probes.ts";
import type { AppContext } from "./context.ts";

export type MeasureOptions = {
  allowDataCollection: boolean;
  onRetry?: (status: number, delayMs: number) => void;
  // Called before each member of a combo, which can take minutes in all.
  onMember?: (member: string, position: number, total: number) => void;
};

export type Measured = { model: string; results: ProbeResult[] }[];

function retries(options: MeasureOptions) {
  return options.onRetry ? { onRetry: options.onRetry } : {};
}

async function measureOpenRouter(context: AppContext, model: string, options: MeasureOptions) {
  const key = await context.secrets.get("openrouter");
  if (!key) throw new Error("Connect OpenRouter first: run amora and choose Connect OpenRouter.");
  const dataCollection = options.allowDataCollection ? "allow" : "deny";
  const openRouter = createOpenRouter(key, { dataCollection });
  const info = await openRouter.model(model);
  if (!info) throw new Error(`OpenRouter has no model called ${model}.`);
  const results = await runProbes(
    openRouter.chat,
    model,
    info.context_length ?? 0,
    retries(options),
  );
  saveProbeResults(context.storage, model, results);
  return [{ model, results }];
}

export async function omniRouteClient(
  context: AppContext,
  options: { timeoutMs?: number; stream?: { idleMs: number; totalMs: number } } = {},
): Promise<OmniRoute> {
  const key = await context.secrets.get("omniroute");
  if (!key) throw new Error("Connect OmniRoute first: amora connect omniroute");
  const url = context.storage.getSetting<{ url: string }>("omniroute")?.url ?? defaultOmniRouteUrl;
  return createOmniRoute(url, key, options);
}

// OmniRoute does not know the context length of every model. An unknown one is
// stored as 0, so a requirement on context fails instead of passing on a guess.
async function measureMember(
  context: AppContext,
  client: OmniRoute,
  models: OmniRouteModel[],
  name: string,
  options: MeasureOptions,
) {
  const model = omniRouteId(name);
  const contextLength = contextOf(models, name);
  const measured = await runProbes(client.chat, name, contextLength ?? 0, retries(options));
  const results = measured.map((result) =>
    result.capability === "context" && contextLength === undefined
      ? { ...result, detail: "unknown: OmniRoute reports no context length" }
      : result,
  );
  saveProbeResults(context.storage, model, results);
  return { model, results };
}

// A combo is probed member by member (PRD §7.6), because a fallback can land on
// any of them. Its membership is saved only once every member has been
// measured, so a run cut short leaves the combo unknown rather than half known.
async function measureOmniRoute(context: AppContext, name: string, options: MeasureOptions) {
  const client = await omniRouteClient(context);
  const models = await client.models();
  if (name.includes("/")) return [await measureMember(context, client, models, name, options)];
  const combo = (await readCombos()).find((candidate) => candidate.name === name);
  if (!combo) throw new Error(`OmniRoute has no combo called ${name}.`);
  const other = combo.members.find((member) => member.kind !== "model");
  if (other) throw new Error(`${name} has a ${other.kind} member, which AMORA cannot probe yet.`);
  const measured: Measured = [];
  for (const [index, member] of combo.members.entries()) {
    options.onMember?.(member.model, index + 1, combo.members.length);
    measured.push(await measureMember(context, client, models, member.model, options));
  }
  saveCombo(context.storage, omniRouteId(name), {
    members: combo.members.map((member) => omniRouteId(member.model)),
    contextLength: combo.contextLength,
    strategy: combo.strategy,
  });
  return measured;
}

export async function measureModel(
  context: AppContext,
  model: string,
  options: MeasureOptions,
): Promise<Measured> {
  const { gateway, name } = parseModelId(model);
  return gateway === "omniroute"
    ? measureOmniRoute(context, name, options)
    : measureOpenRouter(context, model, options);
}
