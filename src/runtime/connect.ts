import { randomBytes } from "node:crypto";
import { authorizationUrl, createVerifier } from "../model-layer/pkce.ts";

// OpenRouter's authorization codes expire after ten minutes, so a pending
// connection that waits longer can never finish anyway.
const flowLifetimeMs = 10 * 60 * 1000;

export type ConnectFlows = {
  start(port: number): string;
  finish(state: string): string | undefined;
  markConnected(state: string): void;
  wasConnected(state: string): boolean;
};

// The redirect back from openrouter.ai is a cross-site navigation, so the
// SameSite=Strict session cookie does not come with it. A single-use state
// value ties the callback to a connection this runtime started instead.
export function createConnectFlows(now: () => number = Date.now): ConnectFlows {
  const pending = new Map<string, { verifier: string; expiresAt: number }>();
  const connected = new Map<string, number>();
  return {
    start(port) {
      const state = randomBytes(24).toString("base64url");
      const verifier = createVerifier();
      pending.set(state, { verifier, expiresAt: now() + flowLifetimeMs });
      // OpenRouter accepts localhost callbacks on any port.
      const callbackUrl = `http://localhost:${port}/connect/openrouter/callback`;
      return authorizationUrl({ callbackUrl, verifier, state });
    },
    finish(state) {
      const flow = pending.get(state);
      pending.delete(state);
      if (!flow || flow.expiresAt < now()) return undefined;
      return flow.verifier;
    },
    // A finished state stays known for a while. The browser's Back button or a
    // reload loads the callback a second time, and that should say "already
    // connected" instead of reporting a failure for a connection that worked.
    markConnected(state) {
      connected.set(state, now() + flowLifetimeMs);
    },
    wasConnected(state) {
      const expiresAt = connected.get(state);
      return expiresAt !== undefined && expiresAt >= now();
    },
  };
}
