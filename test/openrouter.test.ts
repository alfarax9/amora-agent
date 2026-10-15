import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOpenRouter,
  OpenRouterError,
  type ChatRequest,
  type ChatResponse,
} from "../src/model-layer/openrouter.ts";
import { authorizationUrl, codeChallenge, exchangeCode } from "../src/model-layer/pkce.ts";
import { runProbes } from "../src/model-layer/probes.ts";

function reply(content: string | null, toolArguments?: string): ChatResponse {
  const tool_calls = toolArguments
    ? [{ function: { name: "submit_result", arguments: toolArguments } }]
    : undefined;
  return { choices: [{ message: { content, ...(tool_calls ? { tool_calls } : {}) } }] };
}

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
    await assert.rejects(exchangeCode("c", "v", fakeFetch), OpenRouterError);
  });
});

describe("OpenRouter client", () => {
  it("denies data collection and requires parameter support on every chat", async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json(reply("hi"));
    }) as typeof fetch;
    await createOpenRouter("key", fakeFetch).chat({ model: "a/b", messages: [] });
    assert.deepEqual(body.provider, { data_collection: "deny", require_parameters: true });
  });

  it("carries the HTTP status on errors", async () => {
    const fakeFetch = (async () =>
      Response.json({ error: { message: "No credits" } }, { status: 402 })) as typeof fetch;
    await assert.rejects(createOpenRouter("key", fakeFetch).keyInfo(), {
      status: 402,
      message: "No credits",
    });
  });
});

describe("probes", () => {
  it("records a model that passes everything", async () => {
    const chat = async (request: ChatRequest) =>
      request.tools
        ? reply(null, '{"answer":5}')
        : request.response_format
          ? reply('{"answer":5}')
          : reply("Red.");
    const results = await runProbes(chat, "a/b", 128000);
    assert.deepEqual(
      results.map(({ capability, result }) => [capability, result]),
      [
        ["structured_output", "json_schema"],
        ["tool_use", "true"],
        ["vision", "true"],
        ["context", "128000"],
      ],
    );
  });

  it("falls back to JSON mode when strict schemas are refused, and records missing vision", async () => {
    const chat = async (request: ChatRequest) => {
      const format = request.response_format?.type;
      if (format === "json_schema" || Array.isArray(request.messages[0]?.content)) {
        throw new OpenRouterError(404, "No endpoints found");
      }
      return format === "json_object" ? reply('{"answer":5}') : reply("I cannot call tools.");
    };
    const results = Object.fromEntries(
      (await runProbes(chat, "a/b", 8000)).map((r) => [r.capability, r.result]),
    );
    assert.deepEqual(results, {
      structured_output: "json_mode",
      tool_use: "false",
      vision: "false",
      context: "8000",
    });
  });

  it("stops instead of recording a no when the account cannot pay or is rate limited", async () => {
    const chat = async () => {
      throw new OpenRouterError(429, "Rate limited");
    };
    await assert.rejects(runProbes(chat, "a/b", 8000), { status: 429 });
  });
});
