import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOpenRouter,
  OpenRouterError,
  type ChatRequest,
} from "../src/model-layer/openrouter.ts";
import { runProbes } from "../src/model-layer/probes.ts";
import { reply } from "./replies.ts";

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

  it("stops instead of recording a no when the account cannot pay", async () => {
    const chat = async () => {
      throw new OpenRouterError(402, "No credits");
    };
    await assert.rejects(runProbes(chat, "a/b", 8000), { status: 402 });
  });

  describe("busy providers", () => {
    const quickly = { retryDelaysMs: [0, 0] };

    it("waits and tries again after a 429, then records the real answer", async () => {
      let calls = 0;
      const retries: number[] = [];
      const chat = async (request: ChatRequest) => {
        calls += 1;
        if (calls <= 2) throw new OpenRouterError(429, "temporarily rate-limited upstream");
        return request.tools ? reply(null, '{"answer":5}') : reply('{"answer":5}');
      };
      const results = await runProbes(chat, "a/b", 8000, {
        ...quickly,
        onRetry: (status) => retries.push(status),
      });
      assert.deepEqual(retries, [429, 429]);
      assert.equal(results[0]?.result, "json_schema");
    });

    it("gives up after the retries instead of recording a no", async () => {
      let calls = 0;
      const chat = async () => {
        calls += 1;
        throw new OpenRouterError(429, "temporarily rate-limited upstream");
      };
      await assert.rejects(runProbes(chat, "a/b", 8000, quickly), { status: 429 });
      assert.equal(calls, 3);
    });

    it("never records a data policy refusal as a missing capability", async () => {
      let calls = 0;
      const chat = async () => {
        calls += 1;
        throw new OpenRouterError(
          404,
          "No endpoints found matching your data policy (Free model training).",
        );
      };
      await assert.rejects(runProbes(chat, "a/b", 8000, quickly), { dataPolicy: true });
      assert.equal(calls, 1);
    });

    it("retries a busy provider that answered with a 200 and an error", async () => {
      let calls = 0;
      const fakeFetch = (async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as ChatRequest;
        calls += 1;
        if (calls === 1) {
          return Response.json({ error: { message: "Upstream error: limit reached", code: 502 } });
        }
        if (request.tools) return Response.json(reply(null, '{"answer":5}'));
        return Response.json(reply(request.response_format ? '{"answer":5}' : "Red."));
      }) as typeof fetch;
      const client = createOpenRouter("key", { fetchImpl: fakeFetch });
      const retries: number[] = [];
      const results = await runProbes(client.chat, "a/b", 8000, {
        ...quickly,
        onRetry: (status) => retries.push(status),
      });
      assert.deepEqual(retries, [502]);
      assert.equal(results[0]?.result, "json_schema");
    });

    it("leaves tool_choice out when the provider refuses the parameter itself", async () => {
      const toolRequests: ChatRequest[] = [];
      const chat = async (request: ChatRequest) => {
        if (!request.tools) return reply('{"answer":5}');
        toolRequests.push(request);
        if ("tool_choice" in request) {
          throw new OpenRouterError(
            404,
            "No endpoints found that support the provided 'tool_choice' value.",
          );
        }
        return reply(null, '{"answer":5}');
      };
      const results = await runProbes(chat, "a/b", 8000, quickly);
      const tools = results.find((result) => result.capability === "tool_use");
      assert.equal(tools?.result, "true");
      assert.equal(toolRequests.length, 2);
      assert.equal(toolRequests[0]?.tool_choice, "required");
      assert.ok(!("tool_choice" in (toolRequests[1] ?? {})));
    });

    it("counts a model that cannot be forced to call tools but does call them", async () => {
      const refusal = "No endpoints found that support the provided 'tool_choice' value.";
      const chat = async (request: ChatRequest) => {
        if (request.tool_choice === "required") throw new OpenRouterError(404, refusal);
        return request.tools ? reply(null, '{"answer":5}') : reply("Red.");
      };
      const results = await runProbes(chat, "a/b", 8000, quickly);
      const tools = results.find((result) => result.capability === "tool_use");
      assert.equal(tools?.result, "true");
      assert.match(tools?.detail ?? "", /cannot force one/);
    });

    it("does not ask again when a model answers in words instead of calling the tool", async () => {
      let toolRequests = 0;
      const chat = async (request: ChatRequest) => {
        if (!request.tools) return reply('{"answer":5}');
        toolRequests += 1;
        return reply("The answer is 5.");
      };
      const results = await runProbes(chat, "a/b", 8000, quickly);
      const tools = results.find((result) => result.capability === "tool_use");
      assert.equal(tools?.result, "false");
      assert.equal(tools?.detail, "answered without calling the tool");
      assert.equal(toolRequests, 1);
    });

    it("says why a model was refused instead of pretending it answered", async () => {
      const refusals: Record<string, string> = {
        tools: "No endpoints found that support the provided 'tool_choice' value.",
        vision: "No endpoints found that support image input",
      };
      const chat = async (request: ChatRequest) => {
        const kind = request.tools
          ? "tools"
          : Array.isArray(request.messages[0]?.content)
            ? "vision"
            : "json";
        const message = refusals[kind];
        if (message)
          throw new OpenRouterError(
            404,
            `${message} To learn more about provider routing, visit: https://x`,
          );
        return reply('{"answer":5}');
      };
      const results = Object.fromEntries(
        (await runProbes(chat, "a/b", 8000, quickly)).map((r) => [r.capability, r]),
      );
      assert.equal(results.vision?.result, "false");
      assert.equal(results.vision?.detail, "refused: No endpoints found that support image input");
      assert.equal(results.tool_use?.result, "false");
      assert.match(
        results.tool_use?.detail ?? "",
        /^refused: No endpoints found that support the provided/,
      );
      assert.ok(!(results.vision?.detail ?? "").includes("To learn more"));
    });

    it("does not retry an answer that is a real no", async () => {
      let calls = 0;
      const chat = async () => {
        calls += 1;
        throw new OpenRouterError(404, "No endpoints found");
      };
      const results = await runProbes(chat, "a/b", 8000, quickly);
      assert.equal(results[0]?.result, "none");
      // Strict schema and JSON mode, tools forced and then left to the model,
      // then vision.
      assert.equal(calls, 5);
    });
  });
});
