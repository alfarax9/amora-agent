import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { exchangeCode } from "../model-layer/pkce.ts";
import type { Fetch } from "../model-layer/gateway.ts";
import type { ConnectFlows } from "./connect.ts";
import type { Logger } from "./logger.ts";
import { dashboardPage, messagePage } from "./pages.ts";
import { maskSecret } from "./secret-scanner.ts";
import type { SecretStore } from "./secrets.ts";
import { handleTaskApi, type TaskDesk } from "./task-routes.ts";
import { dashboardScript } from "./dashboard-files.ts";
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
  // The agency chat; without it the runtime only connects gateways.
  tasks?: TaskDesk;
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

// Nothing on these pages comes from another origin, and they have no forms.
const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  // Not "no-referrer": under that policy browsers send `Origin: null` on
  // POST requests, and the Origin check (S3) refuses them. "same-origin" keeps
  // the real Origin on our own requests and sends nothing to other sites.
  "Referrer-Policy": "same-origin",
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

const noCodeMessage =
  "OpenRouter did not send an authorization, so AMORA was not connected. If you cancelled, start again from the AMORA tab.";
const unknownStateMessage =
  "This connection link expired, was already used, or was started before AMORA restarted. If AMORA is already connected, close this tab. Otherwise start again from the AMORA tab.";

// The reason goes to the runtime log, so a failed connection can be told apart
// without guessing.
function refuseCallback(
  response: ServerResponse,
  deps: RuntimeDependencies,
  reason: string,
  message: string,
): void {
  deps.logger.warn("OpenRouter callback refused", { reason });
  send(response, 400, messagePage("Connection not completed", message));
}

// This page answers the redirect from openrouter.ai, a cross-site navigation,
// so the SameSite=Strict session cookie is not sent here or on any redirect
// that follows. It shows the result instead of sending the user to a page that
// would ask them to sign in again; the AMORA tab they started from still has
// its session.
const openRouterCallback: Handler = async ({ response, url, deps }) => {
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (deps.flows.wasConnected(state)) {
    const message =
      "This link was already used, so nothing changed. Close this tab and reload the AMORA tab.";
    return send(response, 200, messagePage("OpenRouter is already connected", message));
  }
  if (!code) return refuseCallback(response, deps, "no authorization code", noCodeMessage);
  const verifier = deps.flows.finish(state);
  if (!verifier)
    return refuseCallback(response, deps, "unknown or expired state", unknownStateMessage);
  let key: string;
  try {
    key = await exchangeCode(code, verifier, deps.fetchImpl);
  } catch (error) {
    deps.logger.warn("OpenRouter key exchange failed", { reason: String(error) });
    const message =
      "OpenRouter did not accept the authorization. It may have expired; connect again from the AMORA tab.";
    return send(response, 502, messagePage("Connection not completed", message));
  }
  await deps.secrets.set("openrouter", key);
  deps.flows.markConnected(state);
  deps.logger.info("OpenRouter connected", { key: maskSecret(key) });
  const message = `Key ${maskSecret(key)} is in your keychain. Close this tab and reload the AMORA tab.`;
  send(response, 200, messagePage("OpenRouter connected", message));
};

// The dashboard page runs its own script, served from this origin, which
// talks only to this origin; nothing else may load or connect.
const dashboardSecurity = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};

const home: Handler = async ({ response, deps }) => {
  const key = await deps.secrets.get("openrouter");
  const page = dashboardPage({
    ...(key ? { maskedKey: maskSecret(key) } : {}),
    chat: deps.tasks !== undefined,
  });
  send(response, 200, page, dashboardSecurity);
};

const script: Handler = ({ response, url }) => {
  const body = dashboardScript(url.pathname);
  if (body === undefined)
    return send(response, 404, messagePage("Not found", "There is no page here."));
  send(response, 200, body, { "Content-Type": "text/javascript; charset=utf-8" });
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
  // A link, opened in a new tab so the AMORA tab keeps its session. A GET is
  // safe here: it needs the SameSite=Strict session, which other sites cannot
  // send, and it only starts a flow that expires unused after ten minutes.
  "GET /connect/openrouter": connectOpenRouter,
};

async function taskApi(context: Context): Promise<boolean> {
  const { request, response, url, deps } = context;
  if (!deps.tasks || !url.pathname.startsWith("/api/")) return false;
  const reply = await handleTaskApi(deps.tasks, request, url.pathname);
  if (!reply) return false;
  send(response, reply.status, JSON.stringify(reply.body));
  return true;
}

async function route(context: Context): Promise<void> {
  const { request, response, port, deps } = context;
  const rejection = rejectForeignRequest(request.headers, port);
  if (rejection) return send(response, 403, messagePage("Request refused", rejection));
  const key = `${request.method} ${context.url.pathname}`;
  const publicHandler = publicRoutes[key];
  if (publicHandler) return publicHandler(context);
  const sessionId = readCookie(request.headers.cookie, sessionCookieName(port));
  if (!deps.sessions.isValid(sessionId)) {
    const message = "Open the sign-in link that amora printed in your terminal.";
    return send(response, 401, messagePage("Sign in first", message));
  }
  const handler = sessionRoutes[key];
  if (handler) return handler(context);
  // dashboard-files.ts lists the only scripts served under this path.
  if (request.method === "GET" && context.url.pathname.startsWith("/dashboard/")) {
    return script(context);
  }
  if (await taskApi(context)) return;
  send(response, 404, messagePage("Not found", "There is no page here."));
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
