import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConnectFlows } from "../runtime/connect.ts";
import { createOrchestrator } from "../runtime/orchestrator.ts";
import { readinessGaps } from "../runtime/readiness.ts";
import type { ChatDesk } from "../runtime/chat.ts";
import { assistantId } from "../runtime/answer.ts";
import { brainOf } from "../runtime/brain.ts";
import type { TaskDesk } from "../runtime/task-routes.ts";
import type { Agency } from "../runtime/agency.ts";
import { agencyFor } from "./agency.ts";
import { refreshRegistry } from "../model-layer/registry-source.ts";
import { scheduleReprobes } from "../model-layer/reprobe.ts";
import { createLogger, type Logger } from "../runtime/logger.ts";
import { createSessions } from "../runtime/security.ts";
import { startRuntime } from "../runtime/server.ts";
import { type AppContext, packageRoot } from "./context.ts";
import { measureModel } from "./measure.ts";
import { print } from "./output.ts";
import { projectPath } from "./project.ts";

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

function taskDesk(context: AppContext, agency: Agency, logger: Logger): TaskDesk {
  const orchestrator = createOrchestrator(agency, { logger, autoResume: true });
  orchestrator.recoverInterrupted();
  const roles = Object.fromEntries(context.manifests.map(({ id, role }) => [id, role]));
  const divisions = Object.fromEntries(context.manifests.map(({ id, division }) => [id, division]));
  const project = () => projectPath(context);
  const readiness = () => readinessGaps(agency, project());
  return { orchestrator, storage: context.storage, roles, divisions, readiness, project };
}

// The agency answers in chat through its Assistant, on the Assistant's own
// brain: the model its slot resolves to, as for every worker.
function chatDesk(context: AppContext, agency: Agency, tasks: TaskDesk, logger: Logger): ChatDesk {
  const { orchestrator, readiness, project } = tasks;
  return {
    storage: context.storage,
    work: { orchestrator, readiness, project },
    connect: (model) => agency.connect(model),
    brain: () => brainOf(agency, assistantId),
    prompt: readFileSync(join(packageRoot, "prompts", "chat", "system.md"), "utf8"),
    logger,
  };
}

function dependencies(context: AppContext, logger: Logger) {
  const agency = agencyFor(context);
  const { storage, secrets, manifests, registry } = context;
  const tasks = taskDesk(context, agency, logger);
  return {
    sessions: createSessions(),
    flows: createConnectFlows(),
    secrets,
    logger,
    tasks,
    chats: chatDesk(context, agency, tasks, logger),
    // The same cached price lookup the agency estimates plans with.
    reports: { storage, secrets, manifests, registry, price: agency.price },
  };
}

export async function startAmora(
  context: AppContext,
  port: number,
  { open = true }: { open?: boolean } = {},
): Promise<void> {
  const logger = createLogger();
  const runtime = await startRuntime(port, dependencies(context, logger));
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
  // Without a browser (SSH, a script), the printed link is how to sign in.
  if (open) openBrowser(signIn);
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
