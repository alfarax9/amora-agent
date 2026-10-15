import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

// The runtime only ever listens on 127.0.0.1 (S1). It is not configurable,
// because the dashboard holds keys and spends money.
export const bindAddress = "127.0.0.1";

const signInLifetimeMs = 5 * 60 * 1000;

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

// A page on any website can send requests to 127.0.0.1, and DNS rebinding
// can make one look same-origin. Checking Host and Origin on every request
// stops both (S3).
export function rejectForeignRequest(
  headers: IncomingHttpHeaders,
  port: number,
): string | undefined {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!headers.host || !hosts.includes(headers.host)) return "unexpected Host header";
  const origin = headers.origin;
  if (origin !== undefined && !hosts.some((host) => origin === `http://${host}`)) {
    return "unexpected Origin header";
  }
  return undefined;
}

// Cookies are not scoped by port, so two runtimes on one machine would
// overwrite each other's session without the port in the name.
export function sessionCookieName(port: number): string {
  return `amora_session_${port}`;
}

export function sessionCookie(port: number, sessionId: string): string {
  return `${sessionCookieName(port)}=${sessionId}; HttpOnly; SameSite=Strict; Path=/`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

export type Sessions = {
  issueSignInToken(): string;
  exchange(signInToken: string): string | undefined;
  isValid(sessionId: string | undefined): boolean;
};

// The launcher opens the browser with a one-time sign-in token (S2). The
// token is spent on first use and exchanged for a session that lives as long
// as this runtime process, so restarting AMORA signs everyone out.
export function createSessions(now: () => number = Date.now): Sessions {
  const signInTokens = new Map<string, number>();
  const sessions = new Set<string>();
  return {
    issueSignInToken() {
      const token = randomToken();
      signInTokens.set(token, now() + signInLifetimeMs);
      return token;
    },
    exchange(signInToken) {
      const expiresAt = signInTokens.get(signInToken);
      signInTokens.delete(signInToken);
      if (expiresAt === undefined || expiresAt < now()) return undefined;
      const sessionId = randomToken();
      sessions.add(sessionId);
      return sessionId;
    },
    isValid: (sessionId) => sessionId !== undefined && sessions.has(sessionId),
  };
}
