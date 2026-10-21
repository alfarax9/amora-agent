import { createCaller, type Fetch, GatewayError } from "./gateway.ts";

// An OpenRouter key can carry a spending limit that OpenRouter itself keeps: a
// ceiling that holds even when AMORA's own daily limit counts wrong, as when a
// billed price is far above the listed one. Reading it needs only the key.
// Changing it needs a management key, which can also create and delete keys,
// so AMORA uses it for the one change and never stores it.

const apiBase = "https://openrouter.ai/api/v1";

export const limitResets = ["daily", "weekly", "monthly"] as const;
export type LimitReset = (typeof limitResets)[number];

export type KeyLimit = {
  // OpenRouter's masked form of the key, such as "sk-or-v1-0e6...1c96".
  label: string;
  limitUsd: number | null;
  remainingUsd: number | null;
  reset: LimitReset | null;
  usageUsd: number;
  usageTodayUsd: number;
};

// A field left out stays as it is on OpenRouter; null removes it.
export type LimitChange = { limitUsd?: number | null; reset?: LimitReset | null };

type KeyData = {
  hash?: string;
  label: string;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_daily?: number;
};

export class KeyLimitError extends Error {}

function toLimit(data: KeyData): KeyLimit {
  const reset = limitResets.find((name) => name === data.limit_reset) ?? null;
  return {
    label: data.label,
    limitUsd: data.limit,
    remainingUsd: data.limit_remaining,
    reset,
    usageUsd: data.usage,
    usageTodayUsd: data.usage_daily ?? 0,
  };
}

const caller = (apiKey: string, fetchImpl: Fetch) =>
  createCaller({ baseUrl: apiBase, apiKey, fetchImpl, headers: { "X-Title": "AMORA" } });

export async function readKeyLimit(apiKey: string, fetchImpl: Fetch = fetch): Promise<KeyLimit> {
  return toLimit((await caller(apiKey, fetchImpl)<{ data: KeyData }>("/key")).data);
}

// The management routes list at most 100 keys a page; an account with more
// than a thousand is not one AMORA is meant for.
const pageSize = 100;
const maxPages = 10;

// The management routes name a key by its hash, which the key itself cannot
// read; both sides see the same masked label, so that is what joins them.
async function hashOf(call: ReturnType<typeof caller>, label: string): Promise<string> {
  const found: string[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data } = await call<{ data: KeyData[] }>(`/keys?offset=${page * pageSize}`);
    for (const key of data) if (key.label === label && key.hash) found.push(key.hash);
    if (data.length < pageSize) break;
  }
  const [hash] = found;
  if (found.length > 1) {
    throw new KeyLimitError(`More than one key on this account is shown as ${label}.`);
  }
  if (!hash) {
    throw new KeyLimitError(
      `The management key does not see the key AMORA uses (${label}). Use a management key from the same OpenRouter account.`,
    );
  }
  return hash;
}

function body({ limitUsd, reset }: LimitChange): string {
  return JSON.stringify({
    ...(limitUsd !== undefined ? { limit: limitUsd } : {}),
    ...(reset !== undefined ? { limit_reset: reset } : {}),
  });
}

// OpenRouter answers 401 for a key it does not know and 403 for a key that is
// not a management key; both mean the owner typed the wrong one.
async function asManagement<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof GatewayError) || ![401, 403].includes(error.status)) throw error;
    throw new KeyLimitError(
      "OpenRouter did not accept the management key. Create one at openrouter.ai/settings/management-keys; a regular API key cannot change limits.",
    );
  }
}

export async function setKeyLimit(
  apiKey: string,
  managementKey: string,
  change: LimitChange,
  fetchImpl: Fetch = fetch,
): Promise<KeyLimit> {
  const { label } = await readKeyLimit(apiKey, fetchImpl);
  const manage = caller(managementKey, fetchImpl);
  return asManagement(async () => {
    const hash = await hashOf(manage, label);
    const path = `/keys/${encodeURIComponent(hash)}`;
    const updated = await manage<{ data: KeyData }>(path, { method: "PATCH", body: body(change) });
    return toLimit(updated.data);
  });
}
