import {
  type ChatRequest,
  type ChatResponse,
  failureOf,
  type Fetch,
  GatewayError,
} from "./gateway.ts";

// Work replies stream, so the wait is on silence, not on length: an answer of
// whole files from a reasoning model takes minutes but keeps coming, and a
// fixed limit cut such answers off (No answer within 300 s, in the heavy
// tier). A gateway that sends nothing at all, not even OpenRouter's keep-alive
// comments, for `idleMs` is given up on as a 504, which callers retry like
// any passing gateway failure (four of the heavy tier's failures were such
// silences, on different workers). `totalMs` still bounds the whole, and an
// answer that outlasts it is not retried: it was still arriving.

export type StreamLimits = { idleMs: number; totalMs: number };

type Chunk = {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  model?: string;
  usage?: ChatResponse["usage"];
  error?: { message?: string; code?: unknown };
};

type Reply = {
  content: string;
  finish: string | null;
  model: string | undefined;
  usage: Chunk["usage"];
};

// A failure after the reply started arrives as a data line with an error.
function failIfError({ error }: Chunk): void {
  if (!error) return;
  const status = typeof error.code === "number" ? error.code : 502;
  throw new GatewayError(status, error.message ?? "upstream error");
}

function apply(reply: Reply, data: string): void {
  if (data === "[DONE]") return;
  const chunk = JSON.parse(data) as Chunk;
  failIfError(chunk);
  const choice = chunk.choices?.[0];
  reply.content += choice?.delta?.content ?? "";
  reply.finish = choice?.finish_reason ?? reply.finish;
  reply.model = chunk.model ?? reply.model;
  reply.usage = chunk.usage ?? reply.usage;
}

// Aborting the request does not always end a body already being read, so a
// stop also cancels the reader itself.
async function readEvents(
  body: ReadableStream<Uint8Array>,
  heard: () => void,
  signal: AbortSignal,
): Promise<Reply> {
  const reader = body.getReader();
  signal.addEventListener("abort", () => void reader.cancel().catch(() => undefined));
  const decoder = new TextDecoder();
  const reply: Reply = { content: "", finish: null, model: undefined, usage: undefined };
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    heard();
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.startsWith("data:")) apply(reply, line.slice(5).trim());
  }
  return reply;
}

function toResponse(reply: Reply): ChatResponse {
  return {
    choices: [{ message: { content: reply.content || null }, finish_reason: reply.finish }],
    ...(reply.model ? { model: reply.model } : {}),
    ...(reply.usage ? { usage: reply.usage } : {}),
  };
}

export type StreamTarget = { url: string; headers: Record<string, string>; fetchImpl: Fetch };

export async function streamChat(
  { url, headers, fetchImpl }: StreamTarget,
  body: ChatRequest & Record<string, unknown>,
  { idleMs, totalMs }: StreamLimits,
): Promise<ChatResponse> {
  const controller = new AbortController();
  let stalled: (() => Error) | undefined;
  const stop = (why: () => Error) => () => ((stalled = why), controller.abort());
  const tooLong = () => new Error(`The answer from ${url} took more than ${totalMs / 1000} s.`);
  const silent = () => new GatewayError(504, `No answer from ${url} for ${idleMs / 1000} s.`);
  const total = setTimeout(stop(tooLong), totalMs);
  let idle = setTimeout(stop(silent), idleMs);
  const heard = () => {
    clearTimeout(idle);
    idle = setTimeout(stop(silent), idleMs);
  };
  try {
    const init = { method: "POST", headers, body: JSON.stringify({ ...body, stream: true }) };
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok || !response.body) throw await failureOf(response);
    const reply = await readEvents(response.body, heard, controller.signal);
    // A cancelled reader ends like a finished one; the stop is what happened.
    if (stalled) throw stalled();
    return toResponse(reply);
  } catch (error) {
    if (stalled) throw stalled();
    throw error;
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
}
