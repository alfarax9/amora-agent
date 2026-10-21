#!/usr/bin/env node
import { parseArgs } from "node:util";
import packageJson from "../../package.json" with { type: "json" };
import { GatewayError } from "../model-layer/gateway.ts";
import { defaultOmniRouteUrl } from "../model-layer/omniroute.ts";
import { redactSecrets } from "../runtime/secret-scanner.ts";
import { type AppContext, defaultPort, openContext } from "./context.ts";
import { runDoctor } from "./doctor.ts";
import { runBudget } from "./budget.ts";
import { runCreditLimit } from "./credit-limit.ts";
import { runEval } from "./eval.ts";
import { listModels, setFamily, setModel, unsetModel } from "./models.ts";
import { connectOmniRoute } from "./omniroute.ts";
import { probeAssigned, probeModel } from "./probe.ts";
import { setPrice } from "./prices.ts";
import { runPrivacy } from "./privacy.ts";
import { runRoster } from "./profile.ts";
import { runTaskCommand } from "./run.ts";
import { runDelivery, runProject } from "./project.ts";
import { print, printError } from "./output.ts";
import { draftEntry } from "./registry.ts";
import { startAmora } from "./start.ts";
import { runUndo } from "./undo.ts";

const usage = `Usage: amora [command] [options]

Commands:
  (none)                          Start the runtime and open the dashboard
  budget                          Show the daily spending limit and today's spend
  budget --daily <usd>            Set the daily limit across all tasks (needed before a first task)
  credit-limit [<usd>|none]       Show or set the OpenRouter key's own credit limit, kept by
                                  OpenRouter; a change asks for a management key at a hidden
                                  prompt and does not store it
  project [path]                  Show or set the project folder new tasks work on
  roster [auto|slim|full]         Show or choose the workers new tasks plan with (default: auto,
                                  which gives heavy briefs every worker and light ones the slim roster)
  run "<brief>"                   Run a task without the dashboard, for scripts, CI, and other agents:
                                  plans it, and with --approve and --complete goes on (exit code 0
                                  reached, 1 needs a decision, 3 paused for quota)
  delivery [branch|files]         Show or choose how a completed task reaches the project: a branch
                                  of its own in a git project (default), or files copied in
  undo [task]                     List deliveries that can be undone, or take one back: delete its
                                  branch, or restore the files (--force when files changed since)
  privacy                         Show whether OpenRouter providers may keep or train on prompts
  eval                            Run the benchmark set through AMORA and one strong agent, and
                                  report success and cost per successful task (calls your models)
  connect omniroute               Connect a local OmniRoute; the key is typed at a hidden prompt
  doctor                          Check gateways, keys, plugins, capabilities, hardware, and port
  models                          Show which worker uses which model
  models probe <model>            Measure a model's capabilities through OpenRouter (billed to you)
  models probe --assigned         Measure every model in use again
  models set <scope> <model>      Assign a model, probing it first if it is new; scope is global,
                                  division:<name>, or worker:<id>
  models unset <scope>            Remove an assignment, so that level falls back to the one above
  models family <model> <family>  State a model's base family for the different-family rule, when
                                  the registry does not list it
  models price <model> <in> <out> State a model's price in USD per million tokens, when AMORA cannot
                                  look it up (0 for a subscription such as OmniRoute's providers)
  registry draft <model>          Print a registry entry for a probed model (needs --family, --license)

Options:
  --port <n>               Port to use (default ${defaultPort}); moves to the next free one if taken
  --no-open                Print the sign-in link without opening a browser
  --assigned               With models probe: every model in use
  --daily <usd>            With budget: the daily limit in USD
  --brief <id>             With eval: run only this brief (repeatable)
  --system <names>         With eval: all (default: amora, slim, and baseline), both (amora and
                           baseline), or a comma-separated list of amora, slim, auto, best2
                           (auto twice in parallel, keeping the attempt whose gates passed), and
                           baseline
  --baseline-model <id>    With eval: the baseline's model (default: the global model)
  --reset <period>         With credit-limit: daily, weekly, monthly, or never
  --budget <usd>           With eval or run: each AMORA task's budget (default 1)
  --approve                With run: approve the plan and run every step
  --complete               With run and --approve: deliver the work when every step passed
  --json                   With run: print one JSON object instead of the transcript
  --runs <n>               With eval: run every brief n times per system, 1 to 10 (default 1)
  --tier <name>            With eval: all (default), regression (small and quick), realistic
                           (a React app with real dependencies), or heavy (a product from
                           scratch and new screens with an API)
  --force                  With undo: undo even files changed since the delivery, keeping a copy
  --allow-data-collection  With privacy: let providers that keep or train on prompts serve
                           tasks in this AMORA home; --deny-data-collection turns it off
  --url <url>              With connect omniroute: its API address (default http://localhost:20128/v1)
  --family <name>          Model family for a registry entry (a derived model uses its base's)
  --license <license>      License for a registry entry, from the model card
  --allow-data-collection  Let providers that keep or train on prompts serve one probe (fixed test
                           prompts only; needed for most free models)
  --version                Print the version
  --help                   Print this help`;

type Flags = {
  port: number;
  allowDataCollection: boolean;
  assigned: boolean;
  family: string | undefined;
  license: string | undefined;
  url: string | undefined;
  daily: string | undefined;
  reset: string | undefined;
  denyDataCollection: boolean;
  noOpen: boolean;
  briefs: string[];
  system: string;
  baselineModel: string | undefined;
  budget: string;
  runs: string;
  tier: string;
  force: boolean;
  approve: boolean;
  complete: boolean;
  json: boolean;
};

function privacyChoice(flags: Flags): "allow" | "deny" | undefined {
  if (flags.denyDataCollection) return "deny";
  return flags.allowDataCollection ? "allow" : undefined;
}

// `undefined` means the arguments did not fit the action, so the usage is shown.
type ModelsAction = (
  context: AppContext,
  args: string[],
  flags: Flags,
) => Promise<boolean | undefined>;

const modelsActions: Record<string, ModelsAction> = {
  probe: async (context, [model], flags) => {
    if (flags.assigned) return probeAssigned(context, flags.allowDataCollection);
    return model ? probeModel(context, model, flags.allowDataCollection) : undefined;
  },
  set: async (context, [scope, model], flags) =>
    scope && model ? setModel(context, scope, model, flags.allowDataCollection) : undefined,
  unset: async (context, [scope]) => (scope ? unsetModel(context, scope) : undefined),
  family: async (context, [model, family]) =>
    model && family ? setFamily(context, model, family) : undefined,
  price: async (context, [model, input, output]) =>
    model && input && output ? setPrice(context, model, input, output) : undefined,
};

async function runModels(
  context: AppContext,
  [action, ...args]: string[],
  flags: Flags,
): Promise<boolean> {
  if (action === undefined) return (listModels(context), true);
  const handler = modelsActions[action];
  const outcome = handler ? await handler(context, args, flags) : undefined;
  if (outcome !== undefined) return outcome;
  printError(usage);
  return false;
}

// `undefined` means the arguments did not fit the command, so the usage is shown.
type Command = (context: AppContext, args: string[], flags: Flags) => Promise<boolean | undefined>;

const commands: Record<string, Command> = {
  doctor: (context, _args, flags) => runDoctor(context, flags.port),
  models: (context, args, flags) => runModels(context, args, flags),
  project: async (context, args) => (args.length <= 1 ? runProject(context, args[0]) : undefined),
  roster: async (context, args) => (args.length <= 1 ? runRoster(context, args[0]) : undefined),
  run: async (context, args, flags) =>
    args.length === 1 && args[0] ? runTaskCommand(context, args[0], flags) : undefined,
  delivery: async (context, args) => (args.length <= 1 ? runDelivery(context, args[0]) : undefined),
  undo: async (context, args, flags) =>
    args.length <= 1 ? runUndo(context, args[0], flags.force) : undefined,
  eval: async (context, args, flags) => {
    const budgetUsd = Number(flags.budget);
    const runs = Number(flags.runs);
    const runsFit = Number.isInteger(runs) && runs >= 1 && runs <= 10;
    if (args.length > 0 || !(budgetUsd > 0) || !runsFit) return undefined;
    const { briefs, system, baselineModel, tier } = flags;
    return runEval(context, { briefs, system, baselineModel, budgetUsd, runs, tier });
  },
  privacy: async (context, args, flags) =>
    args.length === 0 ? runPrivacy(context, privacyChoice(flags)) : undefined,
  budget: async (context, args, flags) =>
    args.length === 0 ? runBudget(context, flags.daily) : undefined,
  "credit-limit": async (context, args, flags) =>
    args.length <= 1 ? runCreditLimit(context, args[0], flags.reset) : undefined,
  connect: async (context, [target], flags) =>
    target === "omniroute"
      ? connectOmniRoute(context, flags.url ?? defaultOmniRouteUrl)
      : undefined,
  registry: async (context, [action, model], flags) =>
    action === "draft" && model ? draftEntry(context, model, flags) : undefined,
};

async function run(command: string | undefined, rest: string[], flags: Flags): Promise<boolean> {
  const context = openContext();
  if (command === undefined) {
    return (await startAmora(context, flags.port, { open: !flags.noOpen }), true);
  }
  const outcome = command in commands ? await commands[command]?.(context, rest, flags) : undefined;
  if (outcome !== undefined) return outcome;
  printError(usage);
  return false;
}

const options = {
  port: { type: "string", default: String(defaultPort) },
  "no-open": { type: "boolean", default: false },
  "allow-data-collection": { type: "boolean", default: false },
  "deny-data-collection": { type: "boolean", default: false },
  assigned: { type: "boolean", default: false },
  url: { type: "string" },
  daily: { type: "string" },
  reset: { type: "string" },
  brief: { type: "string", multiple: true },
  system: { type: "string", default: "all" },
  "baseline-model": { type: "string" },
  budget: { type: "string", default: "1" },
  runs: { type: "string", default: "1" },
  tier: { type: "string", default: "all" },
  force: { type: "boolean", default: false },
  approve: { type: "boolean", default: false },
  complete: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  family: { type: "string" },
  license: { type: "string" },
  version: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
} as const;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options });
  if (values.help) return print(usage);
  if (values.version) return print(packageJson.version);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    printError("--port must be a whole number between 1024 and 65535.");
    process.exitCode = 1;
    return;
  }
  const [command, ...rest] = positionals;
  const flags = {
    port,
    allowDataCollection: values["allow-data-collection"],
    assigned: values.assigned,
    family: values.family,
    license: values.license,
    url: values.url,
    daily: values.daily,
    reset: values.reset,
    denyDataCollection: values["deny-data-collection"],
    noOpen: values["no-open"],
    briefs: values.brief ?? [],
    system: values.system,
    baselineModel: values["baseline-model"],
    budget: values.budget,
    runs: values.runs,
    tier: values.tier,
    force: values.force,
    approve: values.approve,
    complete: values.complete,
    json: values.json,
  };
  if (!(await run(command, rest, flags))) process.exitCode = 1;
}

function describeFailure(error: unknown): string {
  if (error instanceof GatewayError) {
    const hint =
      error.status === 429
        ? " Free models share limits and are often busy: wait a minute, or try another model."
        : "";
    return `OpenRouter answered ${error.status}: ${error.message}${hint}`;
  }
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  printError(redactSecrets(describeFailure(error)));
  process.exitCode = 1;
});
