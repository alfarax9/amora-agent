// A quality gate runs the checks a manifest lists, in order, and stops at the
// first one that does not pass (PRD §6.3). The checks themselves are supplied
// by the caller, so this module only decides what a gate's answer is.

type GateCheck = string | Record<string, unknown>;

export type CheckOutcome = {
  result: "passed" | "failed" | "blocked";
  reason: string;
  findings: string[];
};

export type CheckRunner = (options: unknown) => Promise<CheckOutcome>;

function nameOf(check: GateCheck): { name: string; options: unknown } {
  if (typeof check === "string") return { name: check, options: undefined };
  const [name = "", options] = Object.entries(check)[0] ?? [];
  return { name, options };
}

// A check AMORA cannot run blocks the gate and asks the owner. Passing it would
// claim a check that never happened.
export async function runGate(
  gate: GateCheck[],
  runners: Record<string, CheckRunner>,
): Promise<CheckOutcome> {
  const passed: string[] = [];
  for (const check of gate) {
    const { name, options } = nameOf(check);
    const run = runners[name];
    if (!run) {
      return { result: "blocked", reason: `AMORA cannot run the check ${name} yet.`, findings: [] };
    }
    const outcome = await run(options);
    if (outcome.result !== "passed") return outcome;
    passed.push(name);
  }
  return { result: "passed", reason: `Passed: ${passed.join(", ")}.`, findings: [] };
}
