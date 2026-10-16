import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GatewayError } from "../src/model-layer/gateway.ts";
import { createOpenRouter } from "../src/model-layer/openrouter.ts";
import { authorizationUrl, codeChallenge, exchangeCode } from "../src/model-layer/pkce.ts";
import { reply } from "./replies.ts";

describe("PKCE", () => {
  it("derives the RFC 7636 challenge", () => {
    assert.equal(
      codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds the authorization URL", () => {
    const url = new URL(
      authorizationUrl({ callbackUrl: "http://localhost:4310/cb", verifier: "v", state: "s" }),
    );
    assert.equal(url.origin + url.pathname, "https://openrouter.ai/auth");
    assert.equal(url.searchParams.get("callback_url"), "http://localhost:4310/cb");
    assert.equal(url.searchParams.get("code_challenge"), codeChallenge("v"));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), "s");
  });

  it("exchanges the code with the verifier", async () => {
    let sent: unknown;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ key: "sk-or-v1-new" });
    }) as typeof fetch;
    assert.equal(await exchangeCode("the-code", "the-verifier", fakeFetch), "sk-or-v1-new");
    assert.deepEqual(sent, {
      code: "the-code",
      code_verifier: "the-verifier",
      code_challenge_method: "S256",
    });
  });

  it("fails when OpenRouter refuses the code", async () => {
    const fakeFetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    await assert.rejects(exchangeCode("c", "v", fakeFetch), GatewayError);
  });
});

describe("OpenRouter client", () => {
  it("denies data collection and requires parameter support on every chat", async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json(reply("hi"));
    }) as typeof fetch;
    await createOpenRouter("key", { fetchImpl: fakeFetch }).chat({ model: "a/b", messages: [] });
    assert.deepEqual(body.provider, { data_collection: "deny", require_parameters: true });
  });

  it("treats an error inside an HTTP 200 reply as an error, with its own code", async () => {
    const body = {
      id: "gen-1",
      error: {
        message: "Upstream error from Nvidia: ResourceExhausted: request limit reached (16/16)",
        code: 502,
        metadata: { error_type: "provider_unavailable" },
      },
    };
    const fakeFetch = (async () => Response.json(body, { status: 200 })) as typeof fetch;
    await assert.rejects(
      createOpenRouter("key", { fetchImpl: fakeFetch }).chat({ model: "a/b", messages: [] }),
      { status: 502, message: /Upstream error from Nvidia: ResourceExhausted/ },
    );
  });

  it("defaults the code of an error inside a 200 reply to 502", async () => {
    const fakeFetch = (async () => Response.json({ error: { message: "boom" } })) as typeof fetch;
    await assert.rejects(createOpenRouter("key", { fetchImpl: fakeFetch }).keyInfo(), {
      status: 502,
      message: "boom",
    });
  });

  it("sends data_collection allow only when the caller asks for it", async () => {
    const sent: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent.push((JSON.parse(String(init.body)) as { provider: unknown }).provider);
      return Response.json(reply("hi"));
    }) as typeof fetch;
    const request = { model: "a/b", messages: [] };
    await createOpenRouter("key", { fetchImpl: fakeFetch }).chat(request);
    await createOpenRouter("key", { fetchImpl: fakeFetch, dataCollection: "allow" }).chat(request);
    assert.deepEqual(sent, [
      { data_collection: "deny", require_parameters: true },
      { data_collection: "allow", require_parameters: true },
    ]);
  });

  it("marks a data policy refusal and no other 404", async () => {
    const refuse = (message: string) =>
      createOpenRouter("key", {
        fetchImpl: (async () =>
          Response.json({ error: { message } }, { status: 404 })) as typeof fetch,
      }).keyInfo();
    const policy = await refuse(
      "No endpoints found matching your data policy (Free model training).",
    ).catch((caught: unknown) => caught);
    const feature = await refuse("No endpoints found that support tool use.").catch(
      (caught: unknown) => caught,
    );
    assert.ok(policy instanceof GatewayError && policy.dataPolicy);
    assert.ok(feature instanceof GatewayError && !feature.dataPolicy);
  });

  it("keeps the provider and its reason when OpenRouter reports an upstream failure", async () => {
    const body = {
      error: {
        message: "Provider returned error",
        metadata: {
          provider_name: "Google AI Studio",
          raw: { reason: "temporarily rate-limited" },
        },
      },
    };
    const fakeFetch = (async () => Response.json(body, { status: 429 })) as typeof fetch;
    await assert.rejects(createOpenRouter("key", { fetchImpl: fakeFetch }).keyInfo(), {
      status: 429,
      message:
        'Provider returned error from Google AI Studio: {"reason":"temporarily rate-limited"}',
    });
  });

  it("redacts keys and cuts long reasons from upstream errors", async () => {
    const raw = `bad key sk-or-v1-${"a1b2c3d4".repeat(8)} ${"x".repeat(500)}`;
    const body = { error: { message: "Provider returned error", metadata: { raw } } };
    const fakeFetch = (async () => Response.json(body, { status: 502 })) as typeof fetch;
    const error = await createOpenRouter("key", { fetchImpl: fakeFetch })
      .keyInfo()
      .catch((caught: Error) => caught);
    assert.ok(error instanceof Error);
    assert.match(error.message, /\[redacted OpenRouter key\]/);
    assert.ok(!error.message.includes("a1b2c3d4"));
    assert.ok(error.message.length < 400);
  });

  it("carries the HTTP status on errors", async () => {
    const fakeFetch = (async () =>
      Response.json({ error: { message: "No credits" } }, { status: 402 })) as typeof fetch;
    await assert.rejects(createOpenRouter("key", { fetchImpl: fakeFetch }).keyInfo(), {
      status: 402,
      message: "No credits",
    });
  });
});
