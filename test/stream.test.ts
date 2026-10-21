import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Fetch, GatewayError } from "../src/model-layer/gateway.ts";
import { createOmniRoute } from "../src/model-layer/omniroute.ts";
import { createOpenRouter } from "../src/model-layer/openrouter.ts";
import { streamChat } from "../src/model-layer/stream.ts";

// A response whose body sends the given pieces, `gapMs` apart; with `forever`
// it then keeps sending keep-alive comments, and with `stall` it goes quiet.
function sse(pieces: string[], { gapMs = 0, forever = false, stall = false } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const piece of pieces) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
        controller.enqueue(encoder.encode(piece));
      }
      while (forever) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        try {
          controller.enqueue(encoder.encode(": OPENROUTER PROCESSING\n"));
        } catch {
          return;
        }
      }
      if (!stall) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const target = (fetchImpl: Fetch) => ({ url: "https://gw.test/chat", headers: {}, fetchImpl });
const limits = { idleMs: 1000, totalMs: 5000 };
const ask = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };

describe("streamed replies", () => {
  it("assembles the content, the finish reason, the model, and the usage", async () => {
    const pieces = [
      ": OPENROUTER PROCESSING\n",
      event({ model: "m-1", choices: [{ delta: { content: '{"a":' } }] }).slice(0, 20),
      event({ model: "m-1", choices: [{ delta: { content: '{"a":' } }] }).slice(20),
      event({ choices: [{ delta: { content: "1}" }, finish_reason: "stop" }] }),
      event({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, cost: 0.01 } }),
      "data: [DONE]\n\n",
    ];
    const reply = await streamChat(
      target(async () => sse(pieces)),
      ask,
      limits,
    );
    assert.deepEqual(reply, {
      choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }],
      model: "m-1",
      usage: { prompt_tokens: 5, completion_tokens: 3, cost: 0.01 },
    });
  });

  it("turns an error event and a refused request into gateway errors", async () => {
    const failing = sse([event({ error: { message: "Provider down", code: 503 } })]);
    await assert.rejects(
      streamChat(
        target(async () => failing),
        ask,
        limits,
      ),
      (error) => error instanceof GatewayError && error.status === 503,
    );
    const refused = Response.json({ error: { message: "Rate limit" } }, { status: 429 });
    await assert.rejects(
      streamChat(
        target(async () => refused),
        ask,
        limits,
      ),
      (error) => error instanceof GatewayError && error.status === 429,
    );
  });

  it("gives up on silence, but not on a long answer that keeps coming", async () => {
    const stalled = sse([event({ choices: [{ delta: { content: "x" } }] })], { stall: true });
    const quick = { idleMs: 50, totalMs: 5000 };
    await assert.rejects(
      streamChat(
        target(async () => stalled),
        ask,
        quick,
      ),
      {
        message: "No answer from https://gw.test/chat for 0.05 s.",
      },
    );
    const slow = Array.from({ length: 8 }, () => event({ choices: [{ delta: { content: "y" } }] }));
    const reply = await streamChat(
      target(async () => sse(slow, { gapMs: 30 })),
      ask,
      quick,
    );
    assert.equal(reply.choices[0]?.message.content, "yyyyyyyy");
  });

  it("still bounds the whole answer when keep-alives never stop", async () => {
    const endless = sse([], { forever: true });
    await assert.rejects(
      streamChat(
        target(async () => endless),
        ask,
        { idleMs: 1000, totalMs: 100 },
      ),
      { message: "The answer from https://gw.test/chat took more than 0.1 s." },
    );
  });

  it("asks OpenRouter and OmniRoute for a stream with its usage", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: Fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return sse([event({ choices: [{ delta: { content: "ok" } }] })]);
    };
    await createOpenRouter("k", { fetchImpl, stream: limits }).chat(ask);
    await createOmniRoute("http://localhost:20128/v1", "k", { fetchImpl, stream: limits }).chat(
      ask,
    );
    assert.deepEqual(
      bodies.map(({ stream, usage, stream_options, provider }) => ({
        stream,
        usage,
        stream_options,
        provider,
      })),
      [
        {
          stream: true,
          usage: { include: true },
          stream_options: undefined,
          provider: { data_collection: "deny", require_parameters: true },
        },
        {
          stream: true,
          usage: undefined,
          stream_options: { include_usage: true },
          provider: undefined,
        },
      ],
    );
  });
});
