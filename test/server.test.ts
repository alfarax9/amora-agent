import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, it } from "node:test";
import { createConnectFlows } from "../src/runtime/connect.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { memoryStore } from "../src/runtime/secrets.ts";
import { createSessions } from "../src/runtime/security.ts";
import { startRuntime, type Runtime } from "../src/runtime/server.ts";

type Reply = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

// node:http instead of fetch, because fetch will not send a forged Host header.
function send(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (incoming) => {
        let body = "";
        incoming.on("data", (chunk) => (body += chunk));
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("runtime server", () => {
  const sessions = createSessions();
  const secrets = memoryStore();
  const exchanged: unknown[] = [];
  const fullKey = `sk-or-v1-${"f".repeat(64)}`;
  let exchangeStatus = 200;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    exchanged.push(JSON.parse(String(init.body)));
    return Response.json({ key: fullKey }, { status: exchangeStatus });
  }) as typeof fetch;
  let runtime: Runtime;
  let cookie = "";
  let callbackPath = "";

  before(async () => {
    const deps = {
      sessions,
      flows: createConnectFlows(),
      secrets,
      logger: createLogger(() => undefined),
      fetchImpl: fakeFetch,
    };
    runtime = await startRuntime(40000 + Math.floor(Math.random() * 10000), deps);
  });
  after(() => runtime.close());

  it("asks for sign-in without a session", async () => {
    assert.equal((await send(runtime.port, "/")).status, 401);
  });

  it("refuses a foreign Host or Origin even with a session route", async () => {
    assert.equal((await send(runtime.port, "/", { host: "evil.example" })).status, 403);
    assert.equal((await send(runtime.port, "/", { origin: "https://evil.example" })).status, 403);
    assert.equal((await send(runtime.port, "/", { origin: "null" })).status, 403);
  });

  it("exchanges the one-time link for a strict session cookie", async () => {
    const token = new URL(runtime.signInUrl()).searchParams.get("token") ?? "";
    const signIn = await send(runtime.port, `/auth/sign-in?token=${token}`);
    assert.equal(signIn.status, 303);
    const setCookie = String(signIn.headers["set-cookie"]);
    assert.match(setCookie, /HttpOnly; SameSite=Strict/);
    cookie = setCookie.split(";")[0] ?? "";
    assert.equal((await send(runtime.port, `/auth/sign-in?token=${token}`)).status, 401);
  });

  it("serves pages with a strict content security policy", async () => {
    const home = await send(runtime.port, "/", { cookie });
    assert.equal(home.status, 200);
    assert.match(String(home.headers["content-security-policy"]), /default-src 'none'/);
    assert.match(home.body, /Connect OpenRouter/);
    // OpenRouter opens in its own tab, so this tab keeps its session.
    assert.match(home.body, /<a[^>]*href="\/connect\/openrouter"[^>]*target="_blank"/);
  });

  // Browsers send `Origin: null` on POSTs from a no-referrer page, which the
  // Origin check refuses; that broke Connect OpenRouter in Safari and Chrome.
  it("uses a referrer policy that keeps the real Origin", async () => {
    const home = await send(runtime.port, "/", { cookie });
    assert.equal(home.headers["referrer-policy"], "same-origin");
  });

  it("starts a connection only with a session", async () => {
    assert.equal((await send(runtime.port, "/connect/openrouter")).status, 401);
    assert.equal(
      (await send(runtime.port, "/api/connect/openrouter", { cookie }, "POST")).status,
      404,
    );
  });

  it("connects OpenRouter through PKCE and keeps only the masked key visible", async () => {
    const start = await send(runtime.port, "/connect/openrouter", { cookie });
    const authorize = new URL(String(start.headers.location));
    assert.equal(authorize.host, "openrouter.ai");
    callbackPath = `/connect/openrouter/callback?code=abc&state=${authorize.searchParams.get("state")}`;
    const callback = await send(runtime.port, callbackPath, { host: `localhost:${runtime.port}` });
    // A result page, not a redirect: the session cookie does not come back from
    // openrouter.ai, so a redirect to a session page would ask for sign-in.
    assert.equal(callback.status, 200);
    assert.equal(callback.headers.location, undefined);
    assert.match(callback.body, /OpenRouter connected/);
    assert.match(callback.body, /••••ffff/);
    assert.ok(!callback.body.includes(fullKey));
    assert.equal((exchanged[0] as { code: string }).code, "abc");
    assert.equal(await secrets.get("openrouter"), fullKey);
    const status = await send(runtime.port, "/api/status", { cookie });
    assert.equal(status.body, '{"gateways":{"openrouter":{"connected":true,"key":"••••ffff"}}}');
  });

  it("says so when the callback loads a second time, without exchanging the code again", async () => {
    const replayed = await send(runtime.port, callbackPath, { host: `localhost:${runtime.port}` });
    assert.equal(replayed.status, 200);
    assert.match(replayed.body, /OpenRouter is already connected/);
    assert.equal(exchanged.length, 1);
  });

  it("explains a forged state and a missing code differently", async () => {
    const forged = await send(runtime.port, "/connect/openrouter/callback?code=abc&state=forged");
    assert.equal(forged.status, 400);
    assert.match(forged.body, /expired, was already used, or was started before AMORA restarted/);
    const noCode = await send(runtime.port, "/connect/openrouter/callback?state=forged");
    assert.equal(noCode.status, 400);
    assert.match(noCode.body, /did not send an authorization/);
    assert.equal(exchanged.length, 1);
  });

  it("explains a refused or expired authorization code and stores nothing", async () => {
    await secrets.set("openrouter", "sk-or-v1-previous-key-stays");
    const start = await send(runtime.port, "/connect/openrouter", { cookie });
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    exchangeStatus = 403;
    const callback = await send(
      runtime.port,
      `/connect/openrouter/callback?code=old&state=${state}`,
    );
    exchangeStatus = 200;
    assert.equal(callback.status, 502);
    assert.match(callback.body, /did not accept the authorization/);
    assert.equal(await secrets.get("openrouter"), "sk-or-v1-previous-key-stays");
  });

  it("moves to the next port when the preferred one is taken", async () => {
    const deps = {
      sessions,
      flows: createConnectFlows(),
      secrets,
      logger: createLogger(() => undefined),
    };
    const second = await startRuntime(runtime.port, deps);
    assert.equal(second.port, runtime.port + 1);
    await second.close();
  });
});
