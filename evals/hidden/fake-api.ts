import { vi } from "vitest";

// A fake API behind fetch for hidden tests: `reply` answers each call, or a
// 404 does, and every call is recorded with its headers in lower case.

export type ApiCall = {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
};

function parse(body: unknown): unknown {
  if (typeof body !== "string" || body === "") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function fakeApi(
  reply: (call: ApiCall) => Response | Promise<Response> | undefined,
): ApiCall[] {
  const calls: ApiCall[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request = input instanceof Request ? input : undefined;
    const method = (init.method ?? request?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers ?? request?.headers));
    const path = new URL(url, "http://localhost").pathname;
    const call = { method, path, body: parse(init.body), headers };
    calls.push(call);
    return (await reply(call)) ?? new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

// Shown while something loads: a loading text, a progress bar, or a busy region.
export const loadingShown = (document: Document) =>
  /loading/i.test(document.body.textContent ?? "") ||
  document.querySelector('[role="progressbar"], [aria-busy="true"]') !== null;

// An error said in an alert or in words.
export const errorShown = (document: Document) =>
  [...document.querySelectorAll('[role="alert"]')].some((alert) => alert.textContent?.trim()) ||
  /error|fail|could ?n.t|unable|went wrong|try again|problem/i.test(
    document.body.textContent ?? "",
  );
