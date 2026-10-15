#!/usr/bin/env node
import { parseArgs } from "node:util";
import packageJson from "../../package.json" with { type: "json" };
import { redactSecrets } from "../runtime/secret-scanner.ts";
import { type AppContext, defaultPort, openContext } from "./context.ts";
import { runDoctor } from "./doctor.ts";
import { listModels, probeModel, setModel } from "./models.ts";
import { print, printError } from "./output.ts";
import { startAmora } from "./start.ts";

const usage = `Usage: amora [command] [options]

Commands:
  (none)                          Start the runtime and open the dashboard
  doctor                          Check gateways, keys, plugins, capabilities, hardware, and port
  models                          Show which worker uses which model
  models probe <model>            Measure a model's capabilities through OpenRouter
  models set <scope> <model>      Assign a model; scope is global, division:<name>, or worker:<id>

Options:
  --port <n>     Port to use (default ${defaultPort}); moves to the next free one if taken
  --version      Print the version
  --help         Print this help`;

async function runModels(context: AppContext, [action, first, second]: string[]): Promise<boolean> {
  if (action === undefined) return (listModels(context), true);
  if (action === "probe" && first) return probeModel(context, first);
  if (action === "set" && first && second) return setModel(context, first, second);
  printError(usage);
  return false;
}

async function run(command: string | undefined, rest: string[], port: number): Promise<boolean> {
  const context = openContext();
  if (command === undefined) return (await startAmora(context, port), true);
  if (command === "doctor") return runDoctor(context, port);
  if (command === "models") return runModels(context, rest);
  printError(usage);
  return false;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string", default: String(defaultPort) },
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
  if (!(await run(command, rest, port))) process.exitCode = 1;
}

main().catch((error: unknown) => {
  printError(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
