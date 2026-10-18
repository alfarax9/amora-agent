import { createCaller, type Chat, type Fetch } from "./gateway.ts";

// OmniRoute is a local gateway (PRD §7.2) with an OpenAI-compatible API.
export const defaultOmniRouteUrl = "http://localhost:20128/v1";

export type OmniRouteModel = {
  id: string;
  context_length?: number | null;
  context_window?: number | null;
};

export type OmniRoute = {
  chat: Chat;
  models(): Promise<OmniRouteModel[]>;
};

// AMORA sends OmniRoute no provider preferences: OmniRoute routes by its own
// settings and does not read OpenRouter's `provider` field, so AMORA's
// data-collection default (S10) does not reach the providers behind it.
export function createOmniRoute(
  baseUrl: string,
  apiKey: string,
  { fetchImpl = fetch, timeoutMs }: { fetchImpl?: Fetch; timeoutMs?: number } = {},
): OmniRoute {
  const call = createCaller({
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    fetchImpl,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return {
    chat: (request) => call("/chat/completions", { method: "POST", body: JSON.stringify(request) }),
    models: async () => (await call<{ data?: OmniRouteModel[] }>("/models")).data ?? [],
  };
}

// OmniRoute knows the context length for some providers and not for others.
export function contextOf(models: OmniRouteModel[], name: string): number | undefined {
  const model = models.find((candidate) => candidate.id === name);
  const length = model?.context_length ?? model?.context_window;
  return typeof length === "number" && length > 0 ? length : undefined;
}

// A key and every prompt go to this address, so one that is not this machine
// is worth saying out loud.
export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
}
