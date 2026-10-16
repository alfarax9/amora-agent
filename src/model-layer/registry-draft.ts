import { stringify } from "yaml";
import type { ModelInfo } from "./openrouter.ts";
import { parseRegistry, type ModelCapabilities, type RegistryModel } from "./registry.ts";

const tokensPerMillion = 1_000_000;

// OpenRouter prices are USD per token, as strings; the registry keeps USD per
// million tokens (PRD §7.7). Rounded, because 0.0000003 * 1e6 is not exactly 0.3.
function perMillion(perToken: string | undefined): number | undefined {
  const value = perToken === undefined ? Number.NaN : Number(perToken);
  return Number.isFinite(value) ? Number((value * tokensPerMillion).toFixed(6)) : undefined;
}

export type DraftInput = {
  info: ModelInfo;
  capabilities: ModelCapabilities;
  probeDate: string;
  fetchedOn: string;
  family: string;
  license: string;
};

// Capabilities, price, and expiry come from measurements and OpenRouter's own
// listing. The family and the license cannot be measured, so the person adding
// the model states them: a wrong family would break the different-family
// reviewer rule, and nothing here guesses it.
export function draftRegistryEntry(input: DraftInput): RegistryModel {
  const { info, capabilities, probeDate, fetchedOn, family, license } = input;
  const inputPrice = perMillion(info.pricing?.prompt);
  const outputPrice = perMillion(info.pricing?.completion);
  if (inputPrice === undefined || outputPrice === undefined) {
    throw new Error(`OpenRouter lists no price for ${info.id}, so no entry can be drafted.`);
  }
  const cacheRead = perMillion(info.pricing?.input_cache_read);
  return {
    model: info.id,
    base_family: family,
    license,
    expires: info.expiration_date ?? null,
    capabilities,
    probe_date: probeDate,
    pricing: {
      source: "https://openrouter.ai/api/v1/models",
      effective_from: fetchedOn,
      per_million: {
        input: inputPrice,
        output: outputPrice,
        ...(cacheRead === undefined ? {} : { cache_read: cacheRead }),
      },
      // OpenRouter bills reasoning tokens at the output rate.
      reasoning_billed_as: "output",
      tiers: [],
      time_windows: [],
    },
  };
}

// Ready to paste under `models:` in registry/models.yaml.
export function entryToYaml(entry: RegistryModel): string {
  return stringify([entry]);
}

// The same schema the registry is loaded with, so a drafted entry that would
// be rejected on load is caught before anyone pastes it in.
export function entryProblems(entry: RegistryModel): string[] {
  return parseRegistry(stringify({ version: 1, models: [entry] })).errors;
}
