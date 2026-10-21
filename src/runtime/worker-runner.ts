import {
  type Chat,
  type ChatRequest,
  type ChatResponse,
  GatewayError,
} from "../model-layer/gateway.ts";
import type { StructuredOutput } from "../model-layer/registry.ts";
import type { Contract } from "./contracts.ts";
import type { Validation } from "./task-store.ts";

// One call of one worker: the prompt, the input, and an answer checked against
// the worker's output contract. A reply that does not fit goes back to the same
// model once with the problems; fixed, it is Repaired, otherwise Invalid
// (PRD §6.2).

export type WorkerCall = {
  chat: Chat;
  // The model as the gateway names it, such as "fara" for omniroute:fara.
  model: string;
  structured: StructuredOutput;
  prompt: string;
  contract: Contract;
  input: unknown;
  // Checks the schema cannot express, such as a plan naming only real workers.
  check?: (output: unknown) => string[];
};

export type WorkerReply = {
  output?: unknown;
  validation: Validation;
  problems: string[];
  answeredBy: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

// Code is the largest reply a worker gives, and a reasoning model's thinking
// counts against max_tokens: on the heavy tier, replies with whole files hit
// the limit and came back empty or cut off mid-JSON. Workers that write code
// get a larger limit and are asked to think briefly; the others keep 16,000.
const codeContracts = ["code_change.v1", "component_pkg.v1", "test_suite.v1"];

type Limits = Pick<ChatRequest, "max_tokens" | "reasoning">;

function limitsFor({ contract }: WorkerCall): Limits {
  if (!codeContracts.includes(contract.id)) return { max_tokens: 16_000 };
  return { max_tokens: 64_000, reasoning: { effort: "low", exclude: true } };
}

// Models whose gateway refused the reasoning setting in this process; they
// are asked without it from then on.
const noReasoning = new Set<string>();

// OpenRouter only uses providers that honour every parameter, so a model that
// cannot take `reasoning` is refused (400 or 404) rather than answered.
function withoutReasoning(request: ChatRequest): ChatRequest {
  const plain = { ...request };
  delete plain.reasoning;
  return plain;
}

async function chatWithin(call: WorkerCall, request: ChatRequest): Promise<ChatResponse> {
  if (!request.reasoning || noReasoning.has(call.model)) {
    return call.chat(withoutReasoning(request));
  }
  try {
    return await call.chat(request);
  } catch (error) {
    if (!(error instanceof GatewayError) || (error.status !== 400 && error.status !== 404)) {
      throw error;
    }
    noReasoning.add(call.model);
    return call.chat(withoutReasoning(request));
  }
}

// Strict schema output where the model honours it, JSON mode where it only
// promises JSON, and plain text checked afterwards where it offers neither.
function responseFormat({ contract, structured }: WorkerCall) {
  if (structured === "json_schema") {
    const name = contract.id.replace(/[^A-Za-z0-9_-]/g, "_");
    return { type: "json_schema", json_schema: { name, strict: true, schema: contract.schema } };
  }
  return structured === "json_mode" ? { type: "json_object" } : undefined;
}

function systemPrompt({ prompt, contract }: WorkerCall): string {
  return [
    prompt.trim(),
    "Reply with one JSON object that matches this JSON Schema, and nothing else:",
    JSON.stringify(contract.schema),
  ].join("\n\n");
}

// Models without a JSON mode often wrap their answer in a Markdown fence.
function parse(text: string): { value: unknown } | undefined {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return { value: JSON.parse(body) as unknown };
  } catch {
    return undefined;
  }
}

// Said to the worker when its reply ran into max_tokens, whatever it looks like.
function cutOff(reply: ChatResponse | undefined): string[] {
  if (reply?.choices[0]?.finish_reason !== "length") return [];
  const used = reply.usage?.completion_tokens;
  return [
    `The reply was cut off at the output limit${used ? ` (${used} tokens)` : ""} before it ended. Send only the files you change, without unchanged code or long notes, and think briefly.`,
  ];
}

function judge(call: WorkerCall, text: string | null | undefined, reply?: ChatResponse) {
  const cut = cutOff(reply);
  if (cut.length > 0) return { problems: cut };
  if (!text) return { problems: ["The reply was empty."] };
  const parsed = parse(text);
  if (!parsed) return { problems: ["The reply was not valid JSON."] };
  const problems = call.contract.check(parsed.value);
  if (problems.length === 0 && call.check) problems.push(...call.check(parsed.value));
  return { value: parsed.value, problems };
}

function repairRequest(problems: string[]): string {
  return [
    "Your reply does not match the contract:",
    ...problems.map((problem) => `- ${problem}`),
    "Reply again with the corrected JSON object only.",
  ].join("\n");
}

export async function callWorker(call: WorkerCall): Promise<WorkerReply> {
  const format = responseFormat(call);
  const messages: ChatRequest["messages"] = [
    { role: "system", content: systemPrompt(call) },
    { role: "user", content: JSON.stringify(call.input, null, 2) },
  ];
  const replies: ChatResponse[] = [];
  const ask = async () => {
    const reply = await chatWithin(call, {
      model: call.model,
      ...limitsFor(call),
      messages,
      ...(format ? { response_format: format } : {}),
    });
    replies.push(reply);
    return reply.choices[0]?.message.content;
  };
  const firstText = await ask();
  const first = judge(call, firstText, replies.at(-1));
  if (first.problems.length === 0) return summarize(call, replies, "valid", first);
  messages.push(
    { role: "assistant", content: firstText ?? "" },
    { role: "user", content: repairRequest(first.problems) },
  );
  const secondText = await ask();
  const second = judge(call, secondText, replies.at(-1));
  return second.problems.length === 0
    ? summarize(call, replies, "repaired", second)
    : summarize(call, replies, "invalid", { problems: second.problems });
}

function summarize(
  call: WorkerCall,
  replies: ChatResponse[],
  validation: Validation,
  verdict: { value?: unknown; problems: string[] },
): WorkerReply {
  const sum = (pick: (reply: ChatResponse) => number | undefined) =>
    replies.reduce((total, reply) => total + (pick(reply) ?? 0), 0);
  return {
    ...(validation === "invalid" ? {} : { output: verdict.value }),
    validation,
    problems: verdict.problems,
    answeredBy: replies.at(-1)?.model ?? call.model,
    tokensIn: sum((reply) => reply.usage?.prompt_tokens),
    tokensOut: sum((reply) => reply.usage?.completion_tokens),
    costUsd: sum((reply) => reply.usage?.cost),
  };
}
