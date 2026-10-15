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
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    exchanged.push(JSON.parse(String(init.body)));
    return Response.json({ key: `sk-or-v1-${"f".repeat(64)}` });
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
  });

  it("connects OpenRouter through PKCE and keeps only the masked key visible", async () => {
    const start = await send(runtime.port, "/api/connect/openrouter", { cookie }, "POST");
    const authorize = new URL(String(start.headers.location));
    assert.equal(authorize.host, "openrouter.ai");
    callbackPath = `/connect/openrouter/callback?code=abc&state=${authorize.searchParams.get("state")}`;
    const callback = await send(runtime.port, callbackPath, { host: `localhost:${runtime.port}` });
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.location, `http://127.0.0.1:${runtime.port}/`);
    assert.equal((exchanged[0] as { code: string }).code, "abc");
    assert.equal(await secrets.get("openrouter"), `sk-or-v1-${"f".repeat(64)}`);
    const status = await send(runtime.port, "/api/status", { cookie });
    assert.equal(status.body, '{"gateways":{"openrouter":{"connected":true,"key":"••••ffff"}}}');
  });

  it("refuses a replayed or forged callback", async () => {
    const replayed = await send(runtime.port, callbackPath, { host: `localhost:${runtime.port}` });
    assert.equal(replayed.status, 400);
    const forged = await send(runtime.port, "/connect/openrouter/callback?code=abc&state=forged");
    assert.equal(forged.status, 400);
    assert.equal(exchanged.length, 1);
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
