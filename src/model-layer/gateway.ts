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
  // How hard a reasoning model thinks; its thinking counts against max_tokens.
  reasoning?: { effort: "low" | "medium" | "high"; exclude?: boolean };
};

export type ChatResponse = {
  choices: {
    message: {
      content: string | null;
      tool_calls?: { function: { name: string; arguments: string } }[];
    };
    // "length" when the reply hit max_tokens and was cut off.
    finish_reason?: string | null;
  }[];
  // The model that actually answered, which for a combo is the member it fell
  // back to, not the combo's name.
  model?: string;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
};

// `onText` hears a streamed reply as it arrives, piece by piece, for a page
// that shows it the way a chat app does; a reply that is not streamed arrives
// whole, and nothing is heard before it.
export type ChatOptions = { onText?: (text: string) => void };

export type Chat = (request: ChatRequest, options?: ChatOptions) => Promise<ChatResponse>;

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
// a Retry-After in seconds; HTTP also allows a date there. OpenRouter's free
// daily limit says when it resets in X-RateLimit-Reset, in epoch milliseconds.
function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (value === null) return rateLimitResetMs(headers);
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function rateLimitResetMs(headers: Headers): number | undefined {
  const reset = Number(headers.get("x-ratelimit-reset") ?? Number.NaN);
  if (!Number.isFinite(reset) || reset <= 0) return undefined;
  // Epoch seconds or epoch milliseconds, whichever the provider sent.
  const at = reset < 1e12 ? reset * 1000 : reset;
  return Math.max(0, at - Date.now());
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

// Long enough for a short probe answer from a slow free model. Work replies,
// whole files from a reasoning model, take longer; their caller says how long.
const defaultTimeoutMs = 120_000;

// The error a refused or failed request answers with, for this module and for
// streaming replies (stream.ts).
export async function failureOf(response: Response): Promise<GatewayError> {
  const message = await errorMessage(response);
  return new GatewayError(response.status, message, retryAfterMs(response.headers));
}

async function request<T>(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), ...init });
  if (!response.ok) throw await failureOf(response);
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
}

export function createCaller(options: {
  baseUrl: string;
  apiKey: string;
  fetchImpl: Fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Caller {
  const { baseUrl, apiKey, fetchImpl, headers = {}, timeoutMs = defaultTimeoutMs } = options;
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const url = `${baseUrl}${path}`;
    const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    try {
      return await request<T>(
        fetchImpl,
        url,
        { ...init, headers: { ...auth, ...headers } },
        timeoutMs,
      );
    } catch (error) {
      // A gateway that never answers, or stops halfway through its answer,
      // must not leave AMORA waiting forever, and the error has to say what
      // timed out. The limit covers reading the reply, not only its headers.
      if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
      throw new Error(`No answer from ${url} within ${timeoutMs / 1000} s.`, { cause: error });
    }
  };
}

// Free models are often busy: a 429 is the provider rate limiting the model
// for a moment, and 500, 502, and 503 are the provider failing for a moment
// (the first real run met a 500 from a free model's provider). None of them
// says anything about the model or the work, so probes and workers alike wait
// and try again a couple of times before giving up. A 504 is a streamed reply
// that went silent (stream.ts), which a second try usually gets past.
const transientStatuses = [429, 500, 502, 503, 504];
const defaultRetryDelaysMs = [4000, 12000];
// A gateway that says how long to wait knows better than a fixed delay (an
// OmniRoute cooldown lasts about half a minute), but a call must not stall
// for long, so its wish is capped.
const maxRetryWaitMs = 60_000;

export type RetryOptions = {
  retryDelaysMs?: number[];
  onRetry?: (status: number, delayMs: number) => void;
};

export function withRetries(
  chat: Chat,
  { retryDelaysMs = defaultRetryDelaysMs, onRetry }: RetryOptions,
): Chat {
  return async (request, options) => {
    for (const delayMs of retryDelaysMs) {
      try {
        return await chat(request, options);
      } catch (error) {
        const isTransient =
          error instanceof GatewayError && transientStatuses.includes(error.status);
        if (!isTransient) throw error;
        const waitMs = Math.min(Math.max(delayMs, error.retryAfterMs ?? 0), maxRetryWaitMs);
        onRetry?.(error.status, waitMs);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    return chat(request, options);
  };
}
