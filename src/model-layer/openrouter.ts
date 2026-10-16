import { redactSecrets } from "../runtime/secret-scanner.ts";

const apiBase = "https://openrouter.ai/api/v1";

export type Fetch = typeof fetch;

type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ChatRequest = {
  model: string;
  messages: { role: "system" | "user"; content: string | ContentPart[] }[];
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
  usage?: { cost?: number };
};

export type ModelInfo = {
  id: string;
  context_length: number | null;
  expiration_date?: string | null;
  hugging_face_id?: string | null;
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
};

type KeyInfo = {
  label: string;
  is_free_tier: boolean;
  limit_remaining: number | null;
  free_model_daily_requests?: { used: number; limit: number; remaining: number };
};

// Carries the HTTP status so callers can tell "this model cannot do that"
// (400, 404) apart from "try again later" (401, 402, 429, 5xx). A 404 that
// says no endpoint matches the data policy is neither: the model may be
// capable, but every provider that serves it keeps or trains on prompts, which
// the request or the account refuses. `dataPolicy` marks that case.
export class OpenRouterError extends Error {
  readonly status: number;
  readonly dataPolicy: boolean;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.dataPolicy = status === 404 && /data policy/i.test(message);
  }
}

type DataCollection = "deny" | "allow";

type ClientOptions = { fetchImpl?: Fetch; dataCollection?: DataCollection };

export type OpenRouter = {
  chat(request: ChatRequest): Promise<ChatResponse>;
  model(id: string): Promise<ModelInfo | undefined>;
  keyInfo(): Promise<KeyInfo>;
};

export function createOpenRouter(
  apiKey: string,
  { fetchImpl = fetch, dataCollection = "deny" }: ClientOptions = {},
): OpenRouter {
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetchImpl(`${apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "AMORA",
      },
    });
    if (!response.ok) throw new OpenRouterError(response.status, await errorMessage(response));
    const body = (await response.json()) as T & ErrorBody;
    // A failure upstream can arrive as HTTP 200 with an error and no choices,
    // for instance when the provider ran out of capacity after the request was
    // accepted. It is an error like any other, and its code says whether it is
    // worth trying again.
    if (body.error) {
      throw new OpenRouterError(
        body.error.code ?? 502,
        describeError(body.error, "upstream error"),
      );
    }
    return body;
  };
  return {
    // Prompts never go to providers that may store or train on them unless
    // the caller opts in (S10), and only to providers that honor every
    // parameter, so a probe is not answered by one that ignored the schema.
    chat: (request) =>
      call<ChatResponse>("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          ...request,
          provider: { data_collection: dataCollection, require_parameters: true },
        }),
      }),
    model: async (id) => {
      const { data } = await call<{ data: ModelInfo[] }>("/models");
      return data.find((model) => model.id === id);
    },
    keyInfo: async () => (await call<{ data: KeyInfo }>("/key")).data,
  };
}

type Metadata = { provider_name?: string; raw?: unknown };
type ErrorBody = { error?: { message?: string; code?: number; metadata?: Metadata } };

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
