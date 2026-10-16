#!/usr/bin/env node
import { parseArgs } from "node:util";
import packageJson from "../../package.json" with { type: "json" };
import { OpenRouterError } from "../model-layer/openrouter.ts";
import { redactSecrets } from "../runtime/secret-scanner.ts";
import { type AppContext, defaultPort, openContext } from "./context.ts";
import { runDoctor } from "./doctor.ts";
import { listModels, probeAssigned, probeModel, setModel, unsetModel } from "./models.ts";
import { print, printError } from "./output.ts";
import { draftEntry } from "./registry.ts";
import { startAmora } from "./start.ts";

const usage = `Usage: amora [command] [options]

Commands:
  (none)                          Start the runtime and open the dashboard
  doctor                          Check gateways, keys, plugins, capabilities, hardware, and port
  models                          Show which worker uses which model
  models probe <model>            Measure a model's capabilities through OpenRouter (billed to you)
  models probe --assigned         Measure every model in use again
  models set <scope> <model>      Assign a model, probing it first if it is new; scope is global,
                                  division:<name>, or worker:<id>
  models unset <scope>            Remove an assignment, so that level falls back to the one above
  registry draft <model>          Print a registry entry for a probed model (needs --family, --license)

Options:
  --port <n>               Port to use (default ${defaultPort}); moves to the next free one if taken
  --assigned               With models probe: every model in use
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
};

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

async function run(command: string | undefined, rest: string[], flags: Flags): Promise<boolean> {
  const context = openContext();
  if (command === undefined) return (await startAmora(context, flags.port), true);
  if (command === "doctor") return runDoctor(context, flags.port);
  if (command === "models") return runModels(context, rest, flags);
  if (command === "registry" && rest[0] === "draft" && rest[1]) {
    return draftEntry(context, rest[1], flags);
  }
  printError(usage);
  return false;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string", default: String(defaultPort) },
      "allow-data-collection": { type: "boolean", default: false },
      assigned: { type: "boolean", default: false },
      family: { type: "string" },
      license: { type: "string" },
      version: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
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
  };
  if (!(await run(command, rest, flags))) process.exitCode = 1;
}

function describeFailure(error: unknown): string {
  if (error instanceof OpenRouterError) {
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
