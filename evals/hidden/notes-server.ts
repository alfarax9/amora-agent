import { vi } from "vitest";

// A fake notes server behind fetch for hidden tests: GET /api/notes returns
// the given notes, `reply` may answer any call, and every call is recorded.

export type Note = { id: number; title: string; done: boolean; createdAt: string };
export type Call = { method: string; path: string; body: unknown };

export const note = (id: number, title: string, extra: Partial<Note> = {}): Note => ({
  id,
  title,
  done: false,
  createdAt: `2026-10-0${id}T08:00:00Z`,
  ...extra,
});

function parse(body: unknown): unknown {
  if (typeof body !== "string" || body === "") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function fakeServer(
  notes: Note[],
  reply?: (call: Call) => Response | Promise<Response> | undefined,
): Call[] {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const call = {
      method,
      path: new URL(url, "http://localhost").pathname,
      body: parse(init.body),
    };
    calls.push(call);
    const answer = await reply?.(call);
    if (answer) return answer;
    if (method === "GET" && call.path === "/api/notes") return Response.json(notes);
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}
