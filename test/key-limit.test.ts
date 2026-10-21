import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLimitChange } from "../src/cli/credit-limit.ts";
import type { Fetch } from "../src/model-layer/gateway.ts";
import { KeyLimitError, readKeyLimit, setKeyLimit } from "../src/model-layer/key-limit.ts";

const apiKey = `sk-or-v1-${"a".repeat(64)}`;
const managementKey = `sk-or-v1-${"m".repeat(64)}`;
const label = "sk-or-v1-aaa...aaa";

const keyData = (fields: Record<string, unknown> = {}) => ({
  label,
  limit: null,
  limit_remaining: null,
  limit_reset: null,
  usage: 1.25,
  usage_daily: 0.5,
  ...fields,
});

type Seen = { url: string; method: string; auth: string; body?: unknown };

function record(seen: Seen[], url: string | URL | Request, init: RequestInit | undefined) {
  const auth = String((init?.headers as Record<string, string>).Authorization);
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
  seen.push({ url: String(url), method, auth, ...(body ? { body } : {}) });
  const { pathname, search } = new URL(String(url));
  return { path: pathname + search, auth, body };
}

const others = Array.from({ length: 100 }, (_, n) => keyData({ hash: `h${n}`, label: `k${n}` }));

function manage(path: string, body: unknown, otherAccount: boolean): Response {
  if (path === "/api/v1/keys?offset=0") return Response.json({ data: others });
  if (path === "/api/v1/keys?offset=100") {
    return Response.json({ data: otherAccount ? [] : [keyData({ hash: "ours" })] });
  }
  const { limit, limit_reset } = body as { limit?: number; limit_reset?: string };
  const remaining = (limit ?? 0) - 1.25;
  return Response.json({
    data: keyData({ hash: "ours", limit, limit_remaining: remaining, limit_reset }),
  });
}

// OpenRouter as the docs describe it: /key answers to the key itself, the
// /keys routes only to a management key, 100 keys a page.
function fakeOpenRouter(seen: Seen[], { otherAccount = false } = {}): Fetch {
  return async (url, init) => {
    const { path, auth, body } = record(seen, url, init);
    if (path === "/api/v1/key") return Response.json({ data: keyData() });
    if (auth !== `Bearer ${managementKey}`) {
      return Response.json({ error: { message: "Only management keys" } }, { status: 403 });
    }
    return manage(path, body, otherAccount);
  };
}

describe("the OpenRouter key's credit limit", () => {
  it("reads the limit with the key itself", async () => {
    const limit = await readKeyLimit(apiKey, fakeOpenRouter([]));
    assert.deepEqual(limit, {
      label,
      limitUsd: null,
      remainingUsd: null,
      reset: null,
      usageUsd: 1.25,
      usageTodayUsd: 0.5,
    });
  });

  it("finds the key by its label across pages and changes only what was asked", async () => {
    const seen: Seen[] = [];
    const change = { limitUsd: 2, reset: "monthly" as const };
    const limit = await setKeyLimit(apiKey, managementKey, change, fakeOpenRouter(seen));
    assert.equal(limit.limitUsd, 2);
    assert.equal(limit.reset, "monthly");
    assert.equal(limit.remainingUsd, 0.75);
    const patch = seen.at(-1);
    assert.equal(patch?.url, "https://openrouter.ai/api/v1/keys/ours");
    assert.equal(patch?.method, "PATCH");
    assert.deepEqual(patch?.body, { limit: 2, limit_reset: "monthly" });
    // The key reads its own label; only the management routes see the management key.
    assert.equal(seen[0]?.auth, `Bearer ${apiKey}`);
    assert.ok(seen.slice(1).every(({ auth }) => auth === `Bearer ${managementKey}`));
    const resetOnly = [] as Seen[];
    await setKeyLimit(apiKey, managementKey, { reset: null }, fakeOpenRouter(resetOnly));
    assert.deepEqual(resetOnly.at(-1)?.body, { limit_reset: null });
  });

  it("explains a wrong management key and one from another account", async () => {
    await assert.rejects(
      setKeyLimit(apiKey, apiKey, { limitUsd: 2 }, fakeOpenRouter([])),
      (error) =>
        error instanceof KeyLimitError && /did not accept the management key/.test(error.message),
    );
    const seen: Seen[] = [];
    await assert.rejects(
      setKeyLimit(
        apiKey,
        managementKey,
        { limitUsd: 2 },
        fakeOpenRouter(seen, { otherAccount: true }),
      ),
      (error) =>
        error instanceof KeyLimitError && /does not see the key AMORA uses/.test(error.message),
    );
    assert.ok(!seen.some(({ method }) => method === "PATCH"));
  });

  it("reads the command's limit and reset", () => {
    assert.deepEqual(parseLimitChange("2.5", "weekly"), { limitUsd: 2.5, reset: "weekly" });
    assert.deepEqual(parseLimitChange("none", "never"), { limitUsd: null, reset: null });
    assert.deepEqual(parseLimitChange(undefined, "daily"), { reset: "daily" });
    assert.match(String(parseLimitChange("0", undefined)), /above 0/);
    assert.match(String(parseLimitChange("2", "yearly")), /--reset must be/);
  });
});
