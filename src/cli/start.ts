import { spawn } from "node:child_process";
import { createConnectFlows } from "../runtime/connect.ts";
import { refreshRegistry } from "../model-layer/registry-source.ts";
import { scheduleReprobes } from "../model-layer/reprobe.ts";
import { createLogger, type Logger } from "../runtime/logger.ts";
import { createSessions } from "../runtime/security.ts";
import { startRuntime } from "../runtime/server.ts";
import type { AppContext } from "./context.ts";
import { measureModel } from "./measure.ts";
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

// A newer registry is cached for the next start rather than swapped in, so
// the capabilities behind running work never change underneath it.
function refreshRegistryInBackground(context: AppContext, logger: Logger): void {
  refreshRegistry(context.registryCachePath, context.registry.version)
    .then((result) => {
      if (result === "updated")
        logger.info("A newer model registry was downloaded; it applies next start");
    })
    .catch((error: unknown) =>
      logger.warn("Model registry update skipped", { reason: String(error) }),
    );
}

export async function startAmora(context: AppContext, port: number): Promise<void> {
  const logger = createLogger();
  const runtime = await startRuntime(port, {
    sessions: createSessions(),
    flows: createConnectFlows(),
    secrets: context.secrets,
    logger,
  });
  refreshRegistryInBackground(context, logger);
  // Background re-probes never allow data collection; that is chosen per run.
  const stopReprobes = scheduleReprobes({
    storage: context.storage,
    measure: async (model) => {
      await measureModel(context, model, { allowDataCollection: false });
    },
    logger,
  });
  const signIn = runtime.signInUrl();
  if (runtime.port !== port) print(`Port ${port} is in use, so AMORA took ${runtime.port}.`);
  print(`AMORA is running at http://127.0.0.1:${runtime.port}`);
  print(`Sign in (one-time link): ${signIn}`);
  print("Press Ctrl+C to stop.");
  openBrowser(signIn);
  const stop = () => {
    stopReprobes();
    void runtime.close().then(() => {
      context.storage.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
