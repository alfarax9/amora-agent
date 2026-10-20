import { GatewayError } from "../model-layer/gateway.ts";

// A provider out of quota, or rate-limiting past the retries, will serve again
// later, so the task waits for it instead of stopping (seen twice in one week:
// a subscription's accounts out of quota, then OpenRouter's 50 free requests a
// day). The wait comes from the provider when it says: Retry-After or
// X-RateLimit-Reset, or "reset after 5m" in the message; otherwise 15 minutes.

const quotaText = /quota|exhausted|rate.?limit|too many requests/i;
const resetText = /resets?\s+(?:after|in)\s+(\d+)\s*(s|sec|second|m|min|minute|h|hour|d|day)s?\b/i;
const unitMs: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export const defaultQuotaWaitMs = 15 * 60_000;

// How many waits in a row a task may spend on quota before the owner decides;
// a provider that keeps saying "reset after 5m" for hours should not loop.
export const maxQuotaWaits = 5;

const needsOwner = (status: number) => status === 401 || status === 402;

function resetMs(reset: RegExpMatchArray): number {
  const unit = unitMs[(reset[2] ?? "m").charAt(0).toLowerCase()] ?? 60_000;
  return Number(reset[1]) * unit;
}

// How long to wait before trying again, or nothing when the error is not about
// quota. A missing credit (402) or a refused key (401) needs the owner, not time.
export function quotaWaitMs(error: unknown): number | undefined {
  if (!(error instanceof GatewayError) || needsOwner(error.status)) return undefined;
  const reset = error.message.match(resetText);
  if (error.status !== 429 && !reset && !quotaText.test(error.message)) return undefined;
  if (error.retryAfterMs !== undefined && error.retryAfterMs > 0) return error.retryAfterMs;
  return reset ? resetMs(reset) : defaultQuotaWaitMs;
}
