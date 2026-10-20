import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCaller, GatewayError } from "../src/model-layer/gateway.ts";
import { defaultQuotaWaitMs, quotaWaitMs } from "../src/runtime/quota.ts";

describe("telling a quota stop from other errors", () => {
  it("waits as long as the provider says, from a header or the message", () => {
    assert.equal(quotaWaitMs(new GatewayError(429, "slow down", 4000)), 4000);
    assert.equal(quotaWaitMs(new GatewayError(429, "slow down")), defaultQuotaWaitMs);
    const antigravity = "[403]: Antigravity upstream error (403) (reset after 5m)";
    assert.equal(quotaWaitMs(new GatewayError(403, antigravity)), 300_000);
    assert.equal(quotaWaitMs(new GatewayError(503, "Quota resets in 2 hours")), 7_200_000);
    const exhausted = "All antigravity accounts have exhausted their quota";
    assert.equal(quotaWaitMs(new GatewayError(503, exhausted)), defaultQuotaWaitMs);
  });

  it("leaves missing credit, a refused key, and other errors to the owner", () => {
    for (const error of [
      new GatewayError(402, "Insufficient credits; quota reached"),
      new GatewayError(401, "Rate limit for this key"),
      new GatewayError(400, "Bad request"),
      new GatewayError(500, "Internal error"),
      new Error("Rate limit exceeded"),
    ]) {
      assert.equal(quotaWaitMs(error), undefined, error.message);
    }
  });

  it("reads OpenRouter's X-RateLimit-Reset when there is no Retry-After", async () => {
    const reset = Date.now() + 60_000;
    const call = createCaller({
      baseUrl: "https://example.test",
      apiKey: "k",
      fetchImpl: async () =>
        Response.json(
          { error: { message: "Rate limit exceeded: free-models-per-day" } },
          { status: 429, headers: { "X-RateLimit-Reset": String(reset) } },
        ),
    });
    const error = await call("/chat").catch((failure: unknown) => failure);
    assert.ok(error instanceof GatewayError);
    assert.ok((error.retryAfterMs ?? 0) > 55_000 && (error.retryAfterMs ?? 0) <= 60_000);
  });
});
