import { probedCapabilities } from "../model-layer/known-models.ts";
import { createOpenRouter, type ModelInfo } from "../model-layer/openrouter.ts";
import { draftRegistryEntry, entryProblems, entryToYaml } from "../model-layer/registry-draft.ts";
import type { ModelCapabilities } from "../model-layer/registry.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

type DraftFlags = { family: string | undefined; license: string | undefined };
type Facts = { info: ModelInfo; capabilities: ModelCapabilities; probeDate: string };

const missingFlags = (model: string) => [
  "A registry entry needs the model's family and license, which cannot be measured:",
  `  amora registry draft ${model} --family <name> --license <license>`,
  "Take both from the model card. A derived model carries its base model's family.",
];

// What the entry is built from: this machine's probe of the model and
// OpenRouter's listing of it. Says why when either is missing.
async function gatherFacts(context: AppContext, model: string): Promise<Facts | undefined> {
  const probed = probedCapabilities(context.storage, model);
  if (!probed) {
    printError(`Probe it first, so the entry holds measurements: amora models probe ${model}`);
    return undefined;
  }
  const key = await context.secrets.get("openrouter");
  if (!key) {
    printError("Connect OpenRouter first: run amora and choose Connect OpenRouter.");
    return undefined;
  }
  const info = await createOpenRouter(key).model(model);
  if (!info) return (printError(`OpenRouter has no model called ${model}.`), undefined);
  return { info, capabilities: probed.capabilities, probeDate: probed.probedAt.slice(0, 10) };
}

// Prints a registry entry for a model this machine has probed. The YAML goes
// to stdout and every note to stderr, so the YAML can be redirected as is.
export async function draftEntry(
  context: AppContext,
  model: string,
  { family, license }: DraftFlags,
): Promise<boolean> {
  if (!family || !license) {
    for (const line of missingFlags(model)) printError(line);
    return false;
  }
  const facts = await gatherFacts(context, model);
  if (!facts) return false;
  const fetchedOn = new Date().toISOString().slice(0, 10);
  const entry = draftRegistryEntry({ ...facts, fetchedOn, family, license });
  const problems = entryProblems(entry);
  for (const problem of problems) printError(`The drafted entry is invalid: ${problem}`);
  if (problems.length > 0) return false;
  if (facts.info.hugging_face_id) {
    printError(
      `Check the license and base model: https://huggingface.co/${facts.info.hugging_face_id}`,
    );
  }
  printError("Paste this under `models:` in registry/models.yaml and raise `version`:");
  print(entryToYaml(entry).trimEnd());
  return true;
}
