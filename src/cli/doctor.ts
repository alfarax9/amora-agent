import { createServer } from "node:net";
import { availableParallelism, freemem, totalmem } from "node:os";
import { GatewayError } from "../model-layer/gateway.ts";
import { readKeyLimit } from "../model-layer/key-limit.ts";
import { createOpenRouter } from "../model-layer/openrouter.ts";
import { probeMaxAgeDays, staleProbes } from "../model-layer/known-models.ts";
import { assignedModels, resolveWorker } from "../model-layer/slots.ts";
import { formatUsd } from "../runtime/money.ts";
import { dayMs } from "../runtime/time.ts";
import { bindAddress } from "../runtime/security.ts";
import { type AppContext, defaultPort } from "./context.ts";
import { describeLimit } from "./credit-limit.ts";
import { omniRouteClient } from "./measure.ts";
import { print } from "./output.ts";
import { openRouterDataCollection } from "./privacy.ts";
import { rosterProfile } from "./profile.ts";

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
  return [keychain, await checkOpenRouter(key), await checkCreditLimit(key)];
}

// OpenRouter's own ceiling on the key holds even when AMORA's count is wrong,
// so a key without one is worth a warning.
async function checkCreditLimit(key: string): Promise<Check> {
  const label = "Credit limit";
  try {
    const limit = await readKeyLimit(key);
    if (limit.limitUsd !== null) return { status: "pass", label, detail: describeLimit(limit) };
    const detail = `${describeLimit(limit)} (or in the dashboard)`;
    return { status: "warn", label, detail };
  } catch (error) {
    return { status: "warn", label, detail: `could not be read: ${(error as Error).message}` };
  }
}

async function checkOpenRouter(key: string): Promise<Check> {
  try {
    const info = await createOpenRouter(key).keyInfo();
    const free = info.free_model_daily_requests;
    const quota = free ? `, free model requests today: ${free.used} of ${free.limit}` : "";
    return { status: "pass", label: "OpenRouter", detail: `connected${quota}` };
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) {
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

// OmniRoute is optional, so not being connected is not a problem. When it is
// connected, the key is checked against it, the way OpenRouter's is.
async function checkOmniRoute(context: AppContext): Promise<Check> {
  const label = "OmniRoute";
  let client: Awaited<ReturnType<typeof omniRouteClient>>;
  try {
    client = await omniRouteClient(context);
  } catch {
    return { status: "pass", label, detail: "not connected (optional): amora connect omniroute" };
  }
  try {
    const count = (await client.models()).length;
    return {
      status: "pass",
      label,
      detail: `connected, ${count} models; its own settings pick providers`,
    };
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) {
      return {
        status: "fail",
        label,
        detail: "the stored key was rejected; run amora connect omniroute",
      };
    }
    return { status: "warn", label, detail: `could not reach it: ${(error as Error).message}` };
  }
}

function checkDefinitions(context: AppContext): Check[] {
  const problems = [...context.definitionErrors, ...context.registryErrors];
  if (problems.length > 0) {
    return problems.map((detail) => ({ status: "fail" as const, label: "Definitions", detail }));
  }
  const { version, models } = context.registry;
  const detail = `${context.manifests.length} worker manifests, ${context.contracts.length} contracts, registry v${version} (${context.registrySource}) with ${models.length} models`;
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

function checkProbes(context: AppContext): Check {
  const assigned = assignedModels(context.slots);
  const stale = staleProbes(context.storage, assigned);
  if (stale.length > 0) {
    const detail = `${stale.join(", ")} last probed over ${probeMaxAgeDays} days ago; run amora models probe --assigned`;
    return { status: "warn", label: "Probes", detail };
  }
  const detail =
    assigned.length === 0
      ? "no models assigned yet"
      : `no assigned model has a probe older than ${probeMaxAgeDays} days`;
  return { status: "pass", label: "Probes", detail };
}

const expiryWarningDays = 30;

// A model that disappears takes its workers with it, so the ones in use are
// flagged a month ahead.
function checkExpiry(context: AppContext): Check[] {
  return assignedModels(context.slots).flatMap((model) => {
    const expires = context.registry.models.find((entry) => entry.model === model)?.expires;
    if (!expires) return [];
    const days = Math.ceil((Date.parse(expires) - Date.now()) / dayMs);
    if (days > expiryWarningDays) return [];
    const detail =
      days < 0 ? `${model} expired on ${expires}` : `${model} expires on ${expires} (${days} days)`;
    return [{ status: "warn" as const, label: "Expiry", detail }];
  });
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

// Not a failure: AMORA runs without one, but no task can be approved yet.
export function checkBudget(context: Pick<AppContext, "storage">): Check {
  const daily = context.storage.getSetting<{ dailyUsd: number }>("budgets")?.dailyUsd;
  return daily === undefined
    ? { status: "warn", label: "Budget", detail: "no daily limit yet: amora budget --daily <usd>" }
    : { status: "pass", label: "Budget", detail: `daily limit ${formatUsd(daily)}` };
}

function checkRoster(context: AppContext): Check {
  const profile = rosterProfile(context);
  const detail =
    profile === "auto"
      ? "new tasks are weighed: slim roster for light briefs, every worker for heavy ones"
      : `new tasks plan with the ${profile} roster`;
  return { status: "pass", label: "Roster", detail };
}

// Allowed is the owner's choice, so it warns rather than fails.
function checkPrivacy(context: AppContext): Check {
  return openRouterDataCollection(context) === "allow"
    ? {
        status: "warn",
        label: "Privacy",
        detail: "OpenRouter providers may keep or train on prompts",
      }
    : { status: "pass", label: "Privacy", detail: "OpenRouter denies data collection (S10)" };
}

export async function runDoctor(context: AppContext, port = defaultPort): Promise<boolean> {
  const checks: Check[] = [
    checkNode(),
    { status: "pass", label: "Storage", detail: context.storage.database.location() ?? "open" },
    ...(await checkKeychainAndGateway(context)),
    await checkOmniRoute(context),
    // The plugin host ships in M3; until then there is nothing to check.
    { status: "pass", label: "Plugins", detail: "none installed" },
    ...checkDefinitions(context),
    ...checkCapabilities(context),
    checkProbes(context),
    ...checkExpiry(context),
    checkBudget(context),
    checkPrivacy(context),
    checkRoster(context),
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
