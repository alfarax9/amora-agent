import { redactSecrets } from "../runtime/secret-scanner.ts";

// What OpenRouter and OmniRoute have in common: an OpenAI-compatible chat API
// behind a bearer key, and the same ways of failing.

export type Fetch = typeof fetch;

type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ChatRequest = {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string | ContentPart[] }[];
  max_tokens?: number;
  response_format?: Record<string, unknown>;
  tools?: Record<string, unknown>[];
  tool_choice?: unknown;
};

export type ChatResponse = {
  choices: {
    message: {
      content: string | null;
      tool_calls?: { function: { name: string; arguments: string } }[];
    };
  }[];
  // The model that actually answered, which for a combo is the member it fell
  // back to, not the combo's name.
  model?: string;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
};

export type Chat = (request: ChatRequest) => Promise<ChatResponse>;

// Carries the HTTP status so callers can tell "this model cannot do that"
// (400, 404) apart from "try again later" (401, 402, 429, 5xx). A 404 that
// says no endpoint matches the data policy is neither: the model may be
// capable, but every provider that serves it keeps or trains on prompts, which
// the request or the account refuses. `dataPolicy` marks that case.
export class GatewayError extends Error {
  readonly status: number;
  readonly dataPolicy: boolean;
  // How long the gateway asked to wait before trying again, when it said.
  readonly retryAfterMs: number | undefined;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.dataPolicy = status === 404 && /data policy/i.test(message);
    this.retryAfterMs = retryAfterMs;
  }
}

// OmniRoute answers a model whose credentials are cooling down with a 429 and
// a Retry-After in seconds; HTTP also allows a date there.
function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

// Models are named per gateway: `omniroute:<name>` for OmniRoute, a bare id for
// OpenRouter, which came first and keeps its existing names.
export type ModelId = { gateway: "openrouter" | "omniroute"; name: string };

const omniRoutePrefix = "omniroute:";

export function parseModelId(id: string): ModelId {
  return id.startsWith(omniRoutePrefix)
    ? { gateway: "omniroute", name: id.slice(omniRoutePrefix.length) }
    : { gateway: "openrouter", name: id };
}

export function omniRouteId(name: string): string {
  return `${omniRoutePrefix}${name}`;
}

type Metadata = { provider_name?: string; raw?: unknown };
type ErrorBody = { error?: { message?: string; code?: unknown; metadata?: Metadata } };

const maxDetailCharacters = 300;

function upstreamDetail({ provider_name: provider, raw }: Metadata = {}): string {
  const reason = raw === undefined ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
  const text = redactSecrets(reason).slice(0, maxDetailCharacters);
  return `${provider ? ` from ${provider}` : ""}${text ? `: ${text}` : ""}`;
}

function describeError(error: ErrorBody["error"], fallback: string): string {
  return `${error?.message ?? fallback}${upstreamDetail(error?.metadata)}`;
}

// OpenRouter wraps an upstream failure as "Provider returned error" and puts
// the useful part, which provider failed and what it said, in metadata. Keep
// both, redacted and cut short, so a failed call explains itself.
async function errorMessage(response: Response): Promise<string> {
  try {
    const { error } = (await response.json()) as ErrorBody;
    return describeError(error, response.statusText);
  } catch {
    return response.statusText;
  }
}

type Caller = <T>(path: string, init?: RequestInit) => Promise<T>;

// Long enough for a short probe answer from a slow free model.
const requestTimeoutMs = 120_000;

// A gateway that never answers, such as a mistyped address or OmniRoute holding
// a request while every credential of the model cools down, must not leave a
// probe or a connect waiting forever, and the error has to say what timed out.
async function fetchWithin(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(requestTimeoutMs), ...init });
  } catch (error) {
    if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
    throw new Error(`No answer from ${url} within ${requestTimeoutMs / 1000} s.`, {
      cause: error,
    });
  }
}

export function createCaller(options: {
  baseUrl: string;
  apiKey: string;
  fetchImpl: Fetch;
  headers?: Record<string, string>;
}): Caller {
  const { baseUrl, apiKey, fetchImpl, headers = {} } = options;
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetchWithin(fetchImpl, `${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
    });
    if (!response.ok) {
      const message = await errorMessage(response);
      throw new GatewayError(response.status, message, retryAfterMs(response.headers));
    }
    const body = (await response.json()) as T & ErrorBody;
    // A failure upstream can arrive as HTTP 200 with an error and no choices,
    // for instance when the provider ran out of capacity after the request was
    // accepted. It is an error like any other. Its code says whether it is worth
    // trying again, when it is a number; some gateways put a word there.
    if (body.error) {
      const code = body.error.code;
      const status = typeof code === "number" ? code : 502;
      throw new GatewayError(status, describeError(body.error, "upstream error"));
    }
    return body;
  };
}
