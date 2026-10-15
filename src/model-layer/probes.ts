import { redactSecrets } from "../runtime/secret-scanner.ts";
import type { ProbeResult } from "./known-models.ts";
import { OpenRouterError, type OpenRouter } from "./openrouter.ts";

// Probes measure what a model can do instead of trusting provider claims
// (PRD §7.6). Each asks a question with one checkable answer, 2 + 3 or the
// color of a red square, so a pass is unambiguous.

type Chat = OpenRouter["chat"];

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

// 400 and 404 mean the request itself was refused, usually because no
// provider supports the feature; that is a "no". Anything else (no credits,
// rate limit, outage) says nothing about the model, so it stops the run.
async function attempt<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OpenRouterError && [400, 404].includes(error.status)) return undefined;
    throw error;
  }
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
  if (answersFive(strict?.choices[0]?.message.content)) {
    return {
      capability: "structured_output",
      result: "json_schema",
      detail: "strict schema honored",
    };
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
  const isJson = answersFive(loose?.choices[0]?.message.content);
  return {
    capability: "structured_output",
    result: isJson ? "json_mode" : "none",
    detail: isJson ? "JSON mode only" : "no reliable JSON output",
  };
}

async function probeToolUse(chat: Chat, model: string): Promise<ProbeResult> {
  const response = await attempt(() =>
    chat({
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
      tool_choice: "required",
    }),
  );
  const call = response?.choices[0]?.message.tool_calls?.[0]?.function;
  const passed = call?.name === "submit_result" && answersFive(call.arguments);
  return {
    capability: "tool_use",
    result: String(passed),
    detail: passed ? "called the tool" : "no valid tool call",
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
  const reply = response?.choices[0]?.message.content ?? "";
  const passed = /\bred\b/i.test(reply);
  return {
    capability: "vision",
    result: String(passed),
    detail: passed ? "named the color" : redactSecrets(`answered "${reply.slice(0, 60)}"`),
  };
}

export async function runProbes(
  chat: Chat,
  model: string,
  contextLength: number,
): Promise<ProbeResult[]> {
  return [
    await probeStructuredOutput(chat, model),
    await probeToolUse(chat, model),
    await probeVision(chat, model),
    // Probing a million-token window costs too much, so context length is the
    // provider's figure, and the detail says so.
    { capability: "context", result: String(contextLength), detail: "provider metadata" },
  ];
}
