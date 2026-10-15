import { spawn } from "node:child_process";
import { createConnectFlows } from "../runtime/connect.ts";
import { createLogger } from "../runtime/logger.ts";
import { createSessions } from "../runtime/security.ts";
import { startRuntime } from "../runtime/server.ts";
import type { AppContext } from "./context.ts";
import { print } from "./output.ts";

// Opening the browser is a convenience: when it fails (no desktop, SSH
// session), the printed link still works.
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

export async function startAmora(context: AppContext, port: number): Promise<void> {
  const runtime = await startRuntime(port, {
    sessions: createSessions(),
    flows: createConnectFlows(),
    secrets: context.secrets,
    logger: createLogger(),
  });
  const signIn = runtime.signInUrl();
  if (runtime.port !== port) print(`Port ${port} is in use, so AMORA took ${runtime.port}.`);
  print(`AMORA is running at http://127.0.0.1:${runtime.port}`);
  print(`Sign in (one-time link): ${signIn}`);
  print("Press Ctrl+C to stop.");
  openBrowser(signIn);
  const stop = () => {
    void runtime.close().then(() => {
      context.storage.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
