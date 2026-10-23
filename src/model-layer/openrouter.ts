import { createCaller, type Chat, type Fetch } from "./gateway.ts";
import { type StreamLimits, streamChat } from "./stream.ts";

const apiBase = "https://openrouter.ai/api/v1";

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

type DataCollection = "deny" | "allow";

type ClientOptions = {
  fetchImpl?: Fetch;
  dataCollection?: DataCollection;
  timeoutMs?: number;
  // Work replies stream with these limits (stream.ts); probes leave it out.
  stream?: StreamLimits;
};

export type OpenRouter = {
  chat: Chat;
  model(id: string): Promise<ModelInfo | undefined>;
  keyInfo(): Promise<KeyInfo>;
};

export function createOpenRouter(
  apiKey: string,
  { fetchImpl = fetch, dataCollection = "deny", timeoutMs, stream }: ClientOptions = {},
): OpenRouter {
  const call = createCaller({
    baseUrl: apiBase,
    apiKey,
    fetchImpl,
    headers: { "X-Title": "AMORA" },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  const target = {
    url: `${apiBase}/chat/completions`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "AMORA",
    },
    fetchImpl,
  };
  return {
    // Prompts never go to providers that may store or train on them unless
    // the caller opts in (S10), and only to providers that honor every
    // parameter, so a probe is not answered by one that ignored the schema.
    chat: (request, options) => {
      const provider = { data_collection: dataCollection, require_parameters: true };
      if (stream) {
        // The cost arrives in the last event when usage is asked for.
        const body = { ...request, provider, usage: { include: true } };
        return streamChat(target, body, stream, options);
      }
      return call("/chat/completions", {
        method: "POST",
        body: JSON.stringify({ ...request, provider }),
      });
    },
    model: async (id) => {
      const { data } = await call<{ data: ModelInfo[] }>("/models");
      return data.find((model) => model.id === id);
    },
    keyInfo: async () => (await call<{ data: KeyInfo }>("/key")).data,
  };
}
