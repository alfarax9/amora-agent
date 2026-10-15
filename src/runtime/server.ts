import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { exchangeCode } from "../model-layer/pkce.ts";
import type { Fetch } from "../model-layer/openrouter.ts";
import type { ConnectFlows } from "./connect.ts";
import type { Logger } from "./logger.ts";
import { messagePage, statusPage } from "./pages.ts";
import { maskSecret } from "./secret-scanner.ts";
import type { SecretStore } from "./secrets.ts";
import {
  bindAddress,
  readCookie,
  rejectForeignRequest,
  sessionCookie,
  sessionCookieName,
  type Sessions,
} from "./security.ts";

export type RuntimeDependencies = {
  sessions: Sessions;
  flows: ConnectFlows;
  secrets: SecretStore;
  logger: Logger;
  fetchImpl?: Fetch;
};

export type Runtime = { port: number; signInUrl(): string; close(): Promise<void> };

type Context = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  port: number;
  deps: RuntimeDependencies;
};

type Handler = (context: Context) => void | Promise<void>;

// Nothing on these pages comes from another origin, and the only place a form
// may lead is OpenRouter's authorization page.
const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://openrouter.ai; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function send(response: ServerResponse, status: number, body: string, headers = {}): void {
  const type = body.startsWith("{") ? "application/json" : "text/html; charset=utf-8";
  response.writeHead(status, { ...securityHeaders, "Content-Type": type, ...headers });
  response.end(body);
}

function redirect(response: ServerResponse, location: string, headers = {}): void {
  response.writeHead(303, { ...securityHeaders, Location: location, ...headers });
  response.end();
}

const signIn: Handler = ({ response, url, port, deps }) => {
  const sessionId = deps.sessions.exchange(url.searchParams.get("token") ?? "");
  if (!sessionId) {
    const message =
      "This sign-in link was already used or has expired. Run amora again for a new one.";
    return send(response, 401, messagePage("Sign-in link expired", message));
  }
  redirect(response, "/", { "Set-Cookie": sessionCookie(port, sessionId) });
};

const openRouterCallback: Handler = async ({ response, url, port, deps }) => {
  const code = url.searchParams.get("code");
  const verifier = deps.flows.finish(url.searchParams.get("state") ?? "");
  if (!code || !verifier) {
    const message = "OpenRouter was not connected. Start again from the AMORA page.";
    return send(response, 400, messagePage("Connection not completed", message));
  }
  const key = await exchangeCode(code, verifier, deps.fetchImpl);
  await deps.secrets.set("openrouter", key);
  deps.logger.info("OpenRouter connected", { key: maskSecret(key) });
  // The session cookie belongs to 127.0.0.1, and the callback came to localhost.
  redirect(response, `http://${bindAddress}:${port}/`);
};

const home: Handler = async ({ response, deps }) => {
  const key = await deps.secrets.get("openrouter");
  send(response, 200, statusPage(key ? { maskedKey: maskSecret(key) } : {}));
};

const status: Handler = async ({ response, deps }) => {
  const key = await deps.secrets.get("openrouter");
  const openrouter = key ? { connected: true, key: maskSecret(key) } : { connected: false };
  send(response, 200, JSON.stringify({ gateways: { openrouter } }));
};

const connectOpenRouter: Handler = ({ response, port, deps }) => {
  redirect(response, deps.flows.start(port));
};

// The callback cannot carry the session cookie (see connect.ts), and sign-in
// is how a session starts, so these two are the only routes without one.
const publicRoutes: Record<string, Handler> = {
  "GET /auth/sign-in": signIn,
  "GET /connect/openrouter/callback": openRouterCallback,
};

const sessionRoutes: Record<string, Handler> = {
  "GET /": home,
  "GET /api/status": status,
  "POST /api/connect/openrouter": connectOpenRouter,
};

async function route(context: Context): Promise<void> {
  const { request, response, port, deps } = context;
  const rejection = rejectForeignRequest(request.headers, port);
  if (rejection) return send(response, 403, messagePage("Request refused", rejection));
  const key = `${request.method} ${context.url.pathname}`;
  const publicHandler = publicRoutes[key];
  if (publicHandler) return publicHandler(context);
  const handler = sessionRoutes[key];
  if (!handler) return send(response, 404, messagePage("Not found", "There is no page here."));
  const sessionId = readCookie(request.headers.cookie, sessionCookieName(port));
  if (!deps.sessions.isValid(sessionId)) {
    const message = "Open the sign-in link that amora printed in your terminal.";
    return send(response, 401, messagePage("Sign in first", message));
  }
  return handler(context);
}

function listen(port: number, deps: RuntimeDependencies): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${bindAddress}:${port}`);
    route({ request, response, url, port, deps }).catch((error: unknown) => {
      deps.logger.error("Request failed", { path: url.pathname, error: String(error) });
      // Raw exception text can carry keys or paths, so the page never shows it.
      if (!response.headersSent)
        send(response, 500, messagePage("Something went wrong", "Check the runtime log."));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindAddress, () => resolve(server));
  });
}

// When the port is taken, AMORA moves to the next free one (PRD §9) and the
// caller prints the address it got.
export async function startRuntime(
  preferredPort: number,
  deps: RuntimeDependencies,
): Promise<Runtime> {
  for (let port = preferredPort; port < preferredPort + 20; port++) {
    try {
      const server = await listen(port, deps);
      return {
        port,
        signInUrl: () =>
          `http://${bindAddress}:${port}/auth/sign-in?token=${deps.sessions.issueSignInToken()}`,
        close: () => new Promise((resolve) => server.close(() => resolve())),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`Ports ${preferredPort} to ${preferredPort + 19} are all in use.`);
}
