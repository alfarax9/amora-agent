import { execFile } from "node:child_process";

// A combo is OmniRoute's chain of models with fallback. Its members come from
// the local `omniroute` command: the HTTP API that lists them needs a
// management login, while the CLI reads the same local configuration.

type ComboMember = { model: string; kind: string };

export type Combo = {
  name: string;
  strategy: string;
  // OmniRoute's own figure for the combo, which it computes even when it does
  // not know a member's context length.
  contextLength: number | null;
  members: ComboMember[];
};

type RawCombo = {
  name?: string;
  strategy?: string;
  computed_context_length?: number | null;
  models?: { model?: string; kind?: string }[];
};

const colourCodes = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

// The command prints colour codes and "Loaded env" lines before the JSON.
export function parseComboList(text: string): Combo[] {
  const clean = text.replace(colourCodes, "");
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("omniroute combo list printed no JSON.");
  const data = JSON.parse(clean.slice(start)) as { combos?: RawCombo[] };
  return (data.combos ?? []).map((raw) => ({
    name: raw.name ?? "",
    strategy: raw.strategy ?? "priority",
    contextLength:
      typeof raw.computed_context_length === "number" ? raw.computed_context_length : null,
    members: (raw.models ?? []).map((member) => ({
      model: member.model ?? "",
      kind: member.kind ?? "model",
    })),
  }));
}

type RunCli = (args: string[]) => Promise<string>;

function runOmniRouteCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("omniroute", args, { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) =>
      error
        ? reject(new Error(`omniroute ${args.join(" ")} failed: ${error.message}`))
        : resolve(stdout),
    );
  });
}

export async function readCombos(run: RunCli = runOmniRouteCli): Promise<Combo[]> {
  return parseComboList(await run(["combo", "list", "--json"]));
}
