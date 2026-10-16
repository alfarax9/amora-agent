import { GatewayError, parseModelId } from "../model-layer/gateway.ts";
import { probedCapabilities } from "../model-layer/known-models.ts";
import { assignedModels } from "../model-layer/slots.ts";
import type { AppContext } from "./context.ts";
import { measureModel, type Measured } from "./measure.ts";
import { print, printError } from "./output.ts";

function dataPolicyHelp(wasAllowed: boolean): string {
  const settings =
    "OpenRouter must also allow free endpoints that may train on inputs: https://openrouter.ai/settings/privacy";
  if (wasAllowed) {
    return `Even with data collection allowed, OpenRouter found no provider for that model. ${settings}`;
  }
  return [
    "That model has no provider that keeps your prompts private, and AMORA denies data collection by default (S10).",
    "A probe sends only fixed test prompts (2 + 3, and a red square), never your project, so you can allow it for one run:",
    "  amora models probe <model> --allow-data-collection",
    settings,
  ].join("\n");
}

function announce(model: string, allowDataCollection: boolean): void {
  const viaOmniRoute = parseModelId(model).gateway === "omniroute";
  if (allowDataCollection && viaOmniRoute) {
    print("--allow-data-collection does not apply: OmniRoute routes by its own settings.");
  } else if (allowDataCollection) {
    print(
      "Data collection is allowed for this probe only. It sends fixed test prompts, no project data.",
    );
  }
  const where = viaOmniRoute ? "through OmniRoute" : "billed to your OpenRouter account";
  print(`Probing ${model}. This sends a few short requests per model, ${where}.`);
}

// Prints what a probe measured. A combo gets a line per member, then what the
// combo as a whole can do, which is what a worker is checked against.
function printMeasured(context: AppContext, model: string, measured: Measured): void {
  const isCombo = measured.length > 1 || measured[0]?.model !== model;
  for (const { model: member, results } of measured) {
    if (isCombo) print(`  ${member}`);
    const indent = isCombo ? "    " : "  ";
    for (const { capability, result, detail } of results) {
      print(`${indent}${capability}: ${result} (${detail})`);
    }
  }
  const combo = isCombo ? probedCapabilities(context.storage, model)?.capabilities : undefined;
  if (combo) {
    const summary = `vision ${combo.vision}, tool use ${combo.tool_use}, structured output ${combo.structured_output}, context ${combo.context}`;
    print(`  The combo as a whole (what every member can do): ${summary}`);
  }
}

export async function probeModel(
  context: AppContext,
  model: string,
  allowDataCollection: boolean,
): Promise<boolean> {
  announce(model, allowDataCollection);
  const onRetry = (status: number, delayMs: number) =>
    print(`  The provider is busy (${status}); trying again in ${delayMs / 1000} s.`);
  try {
    printMeasured(
      context,
      model,
      await measureModel(context, model, { allowDataCollection, onRetry }),
    );
    return true;
  } catch (error) {
    // A refusal because of the data policy says nothing about the model, so it
    // is explained and nothing is stored. Other gateway errors go to the caller.
    if (error instanceof GatewayError && error.dataPolicy) {
      printError(dataPolicyHelp(allowDataCollection));
      return false;
    }
    if (error instanceof GatewayError) throw error;
    printError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

// Measures every model in use again, whatever its age.
export async function probeAssigned(
  context: AppContext,
  allowDataCollection: boolean,
): Promise<boolean> {
  const models = assignedModels(context.slots);
  if (models.length === 0) {
    print("No models are assigned yet.");
    return true;
  }
  let allProbed = true;
  for (const model of models) {
    allProbed = (await probeModel(context, model, allowDataCollection)) && allProbed;
  }
  return allProbed;
}
