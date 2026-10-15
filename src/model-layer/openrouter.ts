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

type ModelInfo = { id: string; context_length: number | null };

type KeyInfo = {
  label: string;
  is_free_tier: boolean;
  limit_remaining: number | null;
  free_model_daily_requests?: { used: number; limit: number; remaining: number };
};

// Carries the HTTP status so callers can tell "this model cannot do that"
// (400, 404) apart from "try again later" (401, 402, 429, 5xx).
export class OpenRouterError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type OpenRouter = {
  chat(request: ChatRequest): Promise<ChatResponse>;
  model(id: string): Promise<ModelInfo | undefined>;
  keyInfo(): Promise<KeyInfo>;
};

export function createOpenRouter(apiKey: string, fetchImpl: Fetch = fetch): OpenRouter {
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
    return (await response.json()) as T;
  };
  return {
    // Prompts never go to providers that may store or train on them unless
    // the user opts in (S10), and only to providers that honor every
    // parameter, so a probe is not answered by one that ignored the schema.
    chat: (request) =>
      call<ChatResponse>("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          ...request,
          provider: { data_collection: "deny", require_parameters: true },
        }),
      }),
    model: async (id) => {
      const { data } = await call<{ data: ModelInfo[] }>("/models");
      return data.find((model) => model.id === id);
    },
    keyInfo: async () => (await call<{ data: KeyInfo }>("/key")).data,
  };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
