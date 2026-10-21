import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, it } from "node:test";
import { parseLimitChange } from "../src/cli/credit-limit.ts";
import type { Fetch } from "../src/model-layer/gateway.ts";
import { KeyLimitError, readKeyLimit, setKeyLimit } from "../src/model-layer/key-limit.ts";
import { createConnectFlows } from "../src/runtime/connect.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { memoryStore } from "../src/runtime/secrets.ts";
import { createSessions } from "../src/runtime/security.ts";
import { startRuntime, type Runtime } from "../src/runtime/server.ts";

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

type Reply = { status: number; body: string };

function send(port: number, path: string, cookie: string, method = "GET", body?: unknown) {
  return new Promise<Reply>((resolve, reject) => {
    const headers: Record<string, string> = { host: `127.0.0.1:${port}`, cookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    const outgoing = request({ host: "127.0.0.1", port, path, method, headers }, (incoming) => {
      let text = "";
      incoming.on("data", (chunk) => (text += chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body: text }));
    });
    outgoing.on("error", reject);
    outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe("the credit-limit settings in the dashboard", () => {
  const sessions = createSessions();
  const secrets = memoryStore();
  const logged: string[] = [];
  let runtime: Runtime;
  let cookie = "";

  before(async () => {
    const deps = {
      sessions,
      flows: createConnectFlows(),
      secrets,
      logger: createLogger((line) => void logged.push(line)),
      fetchImpl: fakeOpenRouter([]),
    };
    runtime = await startRuntime(40000 + Math.floor(Math.random() * 10000), deps);
    const token = new URL(runtime.signInUrl()).searchParams.get("token") ?? "";
    const signIn = await new Promise<string>((resolve) => {
      request(
        {
          host: "127.0.0.1",
          port: runtime.port,
          path: `/auth/sign-in?token=${token}`,
          headers: { host: `127.0.0.1:${runtime.port}` },
        },
        (incoming) => resolve(String(incoming.headers["set-cookie"]).split(";")[0] ?? ""),
      ).end();
    });
    cookie = signIn;
  });
  after(() => runtime.close());

  it("asks for OpenRouter first, and shows the panel once it is connected", async () => {
    const before = await send(runtime.port, "/api/openrouter/limit", cookie);
    assert.equal(before.status, 409);
    assert.doesNotMatch((await send(runtime.port, "/", cookie)).body, /credit-limit-panel/);
    await secrets.set("openrouter", apiKey);
    assert.match((await send(runtime.port, "/", cookie)).body, /credit-limit-panel/);
    const read = await send(runtime.port, "/api/openrouter/limit", cookie);
    assert.equal(read.status, 200);
    assert.equal((JSON.parse(read.body) as { limit: { label: string } }).limit.label, label);
  });

  it("changes the limit without storing, logging, or answering with the management key", async () => {
    const wanted = { limitUsd: 3, reset: "daily", managementKey };
    const changed = await send(runtime.port, "/api/openrouter/limit", cookie, "POST", wanted);
    assert.equal(changed.status, 200);
    assert.equal((JSON.parse(changed.body) as { limit: { limitUsd: number } }).limit.limitUsd, 3);
    assert.ok(!changed.body.includes(managementKey));
    assert.ok(logged.some((line) => line.includes("OpenRouter key limit changed")));
    assert.ok(!logged.some((line) => line.includes(managementKey)));
    assert.equal(await secrets.get("openrouter"), apiKey);
  });

  it("refuses a bad limit, and a regular key in place of a management key", async () => {
    const zero = { limitUsd: 0, reset: null, managementKey };
    const refused = await send(runtime.port, "/api/openrouter/limit", cookie, "POST", zero);
    assert.equal(refused.status, 400);
    const regular = { limitUsd: 3, reset: null, managementKey: apiKey };
    const wrong = await send(runtime.port, "/api/openrouter/limit", cookie, "POST", regular);
    assert.equal(wrong.status, 400);
    assert.match(wrong.body, /did not accept the management key/);
  });
});
