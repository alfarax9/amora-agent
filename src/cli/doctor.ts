import { createServer } from "node:net";
import { availableParallelism, freemem, totalmem } from "node:os";
import { createOpenRouter, OpenRouterError } from "../model-layer/openrouter.ts";
import { resolveWorker } from "../model-layer/slots.ts";
import { bindAddress } from "../runtime/security.ts";
import { type AppContext, defaultPort } from "./context.ts";
import { print } from "./output.ts";

type Status = "pass" | "warn" | "fail";
type Check = { status: Status; label: string; detail: string };

const marks: Record<Status, string> = { pass: "✓", warn: "!", fail: "✗" };
const minimumNode = 24;

function checkNode(): Check {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= minimumNode
    ? { status: "pass", label: "Node.js", detail: `v${process.versions.node}` }
    : {
        status: "fail",
        label: "Node.js",
        detail: `v${process.versions.node}; AMORA needs ${minimumNode} or newer`,
      };
}

async function checkKeychainAndGateway(context: AppContext): Promise<Check[]> {
  let key: string | undefined;
  try {
    key = await context.secrets.get("openrouter");
  } catch (error) {
    return [
      { status: "fail", label: "Keychain", detail: `not reachable: ${(error as Error).message}` },
    ];
  }
  const keychain: Check = { status: "pass", label: "Keychain", detail: "reachable" };
  if (!key) {
    const detail = "not connected; run amora and choose Connect OpenRouter";
    return [keychain, { status: "warn", label: "OpenRouter", detail }];
  }
  return [keychain, await checkOpenRouter(key)];
}

async function checkOpenRouter(key: string): Promise<Check> {
  try {
    const info = await createOpenRouter(key).keyInfo();
    const free = info.free_model_daily_requests;
    const quota = free ? `, free model requests today: ${free.used} of ${free.limit}` : "";
    return { status: "pass", label: "OpenRouter", detail: `connected${quota}` };
  } catch (error) {
    if (error instanceof OpenRouterError && error.status === 401) {
      return {
        status: "fail",
        label: "OpenRouter",
        detail: "the stored key was rejected; connect again",
      };
    }
    return {
      status: "warn",
      label: "OpenRouter",
      detail: `could not reach it: ${(error as Error).message}`,
    };
  }
}

function checkDefinitions(context: AppContext): Check[] {
  const problems = [...context.manifestErrors, ...context.registryErrors];
  if (problems.length > 0) {
    return problems.map((detail) => ({ status: "fail" as const, label: "Definitions", detail }));
  }
  const { version, models } = context.registry;
  const detail = `${context.manifests.length} worker manifests, registry v${version} (${context.registrySource}) with ${models.length} models`;
  return [{ status: "pass", label: "Definitions", detail }];
}

// A worker without a fitting model is a warning, not a failure: AMORA still
// runs, that worker just cannot take work until it gets one.
function checkCapabilities(context: AppContext): Check[] {
  if (context.manifests.length === 0) {
    return [{ status: "warn", label: "Capabilities", detail: "no worker manifests to check" }];
  }
  const unresolved = context.manifests
    .map((manifest) => resolveWorker(manifest, context.slots, context.lookup))
    .filter((resolution) => resolution.problems.length > 0);
  if (unresolved.length === 0) {
    return [
      { status: "pass", label: "Capabilities", detail: "every worker has a model that fits" },
    ];
  }
  return unresolved.map(({ worker, problems }) => ({
    status: "warn" as const,
    label: "Capabilities",
    detail: `${worker}: ${problems.join(" ")}`,
  }));
}

function checkHardware(): Check {
  const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
  const detail = `${availableParallelism()} CPU threads, ${gib(freemem())} of ${gib(totalmem())} GiB memory free`;
  return { status: "pass", label: "Hardware", detail };
}

function checkPort(port: number): Promise<Check> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () =>
      resolve({
        status: "warn",
        label: "Port",
        detail: `${port} is in use; amora will take the next free port`,
      }),
    );
    server.listen(port, bindAddress, () =>
      server.close(() => resolve({ status: "pass", label: "Port", detail: `${port} is free` })),
    );
  });
}

export async function runDoctor(context: AppContext, port = defaultPort): Promise<boolean> {
  const checks: Check[] = [
    checkNode(),
    { status: "pass", label: "Storage", detail: context.storage.database.location() ?? "open" },
    ...(await checkKeychainAndGateway(context)),
    // The plugin host ships in M3; until then there is nothing to check.
    { status: "pass", label: "Plugins", detail: "none installed" },
    ...checkDefinitions(context),
    ...checkCapabilities(context),
    checkHardware(),
    await checkPort(port),
  ];
  const width = Math.max(...checks.map((check) => check.label.length));
  for (const { status, label, detail } of checks)
    print(`${marks[status]} ${label.padEnd(width)}  ${detail}`);
  const failed = checks.filter((check) => check.status === "fail").length;
  print();
  print(
    failed === 0
      ? "No problems that stop AMORA from running."
      : `${failed} problem(s) need fixing.`,
  );
  return failed === 0;
}
