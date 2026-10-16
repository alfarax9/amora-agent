import { redactSecrets } from "../runtime/secret-scanner.ts";
import type { ProbeResult } from "./known-models.ts";
import { type Chat, type ChatRequest, type ChatResponse, GatewayError } from "./gateway.ts";

// Probes measure what a model can do instead of trusting provider claims
// (PRD §7.6). Each asks a question with one checkable answer, 2 + 3 or the
// color of a red square, so a pass is unambiguous.

// 64×64 solid #FF0000 PNG.
const redSquare =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC";

// Reasoning models spend tokens thinking before they answer; a tight limit
// would cut them off and record a false "no".
const maxTokens = 300;

const answerSchema = {
  type: "object",
  properties: { answer: { type: "integer" } },
  required: ["answer"],
  additionalProperties: false,
};

// A refusal is OpenRouter saying no provider of the model can serve this
// request, usually because a feature is missing; that is a "no", and its
// reason is kept so the result can say why. Anything else (no credits, rate
// limit, outage, or a data policy that no provider of the model meets) says
// nothing about the model, so it stops the run instead of recording a
// capability the model may well have.
type Attempt = { reply: ChatResponse } | { refusal: string };

async function attempt(run: () => Promise<ChatResponse>): Promise<Attempt> {
  try {
    return { reply: await run() };
  } catch (error) {
    const isRefusal = error instanceof GatewayError && [400, 404].includes(error.status);
    if (isRefusal && !error.dataPolicy) return { refusal: error.message };
    throw error;
  }
}

function contentOf(result: Attempt): string | null | undefined {
  return "reply" in result ? result.reply.choices[0]?.message.content : undefined;
}

// OpenRouter ends these messages with a link about provider routing; the
// reason is the part before it.
function refusalDetail(result: Attempt, fallback: string): string {
  if (!("refusal" in result)) return fallback;
  const reason = redactSecrets(result.refusal)
    .replace(/ To learn more.*$/s, "")
    .slice(0, 160);
  return `refused: ${reason}`;
}

function answersFive(text: string | null | undefined): boolean {
  try {
    const parsed = JSON.parse(text ?? "") as Record<string, unknown>;
    return parsed.answer === 5 && Object.keys(parsed).length === 1;
  } catch {
    return false;
  }
}

async function probeStructuredOutput(chat: Chat, model: string): Promise<ProbeResult> {
  const capability = "structured_output";
  const strict = await attempt(() =>
    chat({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: "What is 2 + 3? Reply in the requested format." }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", strict: true, schema: answerSchema },
      },
    }),
  );
  if (answersFive(contentOf(strict))) {
    return { capability, result: "json_schema", detail: "strict schema honored" };
  }
  const loose = await attempt(() =>
    chat({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "user", content: 'What is 2 + 3? Reply only with JSON: {"answer": <number>}' },
      ],
      response_format: { type: "json_object" },
    }),
  );
  if (answersFive(contentOf(loose)))
    return { capability, result: "json_mode", detail: "JSON mode only" };
  return { capability, result: "none", detail: refusalDetail(loose, "no reliable JSON output") };
}

function toolRequest(model: string, toolChoice?: "required"): ChatRequest {
  return {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: "Call submit_result with the answer to 2 + 3." }],
    tools: [
      {
        type: "function",
        function: {
          name: "submit_result",
          description: "Submit the answer.",
          parameters: answerSchema,
        },
      },
    ],
    // Left out rather than sent as "auto": some endpoints refuse the parameter
    // itself, and leaving the choice to the model is what omitting it means.
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };
}

function calledTool(result: Attempt): boolean {
  if (!("reply" in result)) return false;
  const call = result.reply.choices[0]?.message.tool_calls?.[0]?.function;
  return call?.name === "submit_result" && answersFive(call.arguments);
}

// Forcing a tool call is stricter than calling tools: some providers refuse
// `required` yet call tools when the model decides, and a refusal of `required`
// must not count against tool use. So it is tried first, then left to the model.
async function probeToolUse(chat: Chat, model: string): Promise<ProbeResult> {
  const capability = "tool_use";
  const forced = await attempt(() => chat(toolRequest(model, "required")));
  if (calledTool(forced)) return { capability, result: "true", detail: "called the tool" };
  if ("reply" in forced) {
    return { capability, result: "false", detail: "answered without calling the tool" };
  }
  const left = await attempt(() => chat(toolRequest(model)));
  if (calledTool(left)) {
    return { capability, result: "true", detail: "called the tool; the provider cannot force one" };
  }
  return {
    capability,
    result: "false",
    detail: refusalDetail(left, "answered without calling the tool"),
  };
}

async function probeVision(chat: Chat, model: string): Promise<ProbeResult> {
  const response = await attempt(() =>
    chat({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What color is this square? Answer with one word." },
            { type: "image_url", image_url: { url: redSquare } },
          ],
        },
      ],
    }),
  );
  const reply = contentOf(response) ?? "";
  const passed = /\bred\b/i.test(reply);
  const answered = redactSecrets(`answered "${reply.slice(0, 60)}"`);
  return {
    capability: "vision",
    result: String(passed),
    detail: passed ? "named the color" : refusalDetail(response, answered),
  };
}

// Free models are often busy: a 429 is the provider rate limiting the model
// for a moment, and 502 and 503 are the provider failing for a moment. None of
// them says anything about what the model can do, so each call waits and tries
// again a couple of times before giving up.
const transientStatuses = [429, 502, 503];
const defaultRetryDelaysMs = [4000, 12000];

type RetryOptions = {
  retryDelaysMs?: number[];
  onRetry?: (status: number, delayMs: number) => void;
};

function withRetries(
  chat: Chat,
  { retryDelaysMs = defaultRetryDelaysMs, onRetry }: RetryOptions,
): Chat {
  return async (request) => {
    for (const delayMs of retryDelaysMs) {
      try {
        return await chat(request);
      } catch (error) {
        const isTransient =
          error instanceof GatewayError && transientStatuses.includes(error.status);
        if (!isTransient) throw error;
        onRetry?.(error.status, delayMs);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return chat(request);
  };
}

export async function runProbes(
  chat: Chat,
  model: string,
  contextLength: number,
  options: RetryOptions = {},
): Promise<ProbeResult[]> {
  const patient = withRetries(chat, options);
  return [
    await probeStructuredOutput(patient, model),
    await probeToolUse(patient, model),
    await probeVision(patient, model),
    // Probing a million-token window costs too much, so context length is the
    // provider's figure, and the detail says so.
    { capability: "context", result: String(contextLength), detail: "provider metadata" },
  ];
}
