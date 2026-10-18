import type { CheckOutcome } from "./gates.ts";
import type { Handoff, Plan } from "./task-store.ts";

// A Tester that finds a bug in earlier code cannot pass its own gate: its tests
// fail, and it may not change the code. The real-model newsletter run stalled
// exactly there. So when a worker's test run fails and it names defects in
// files an earlier step of this task wrote, the work goes back to that step
// (PRD §6.3: a failed gate returns the work with the findings).

type Defect = { file: string; problem: string };

export type SendBack = { step: number; worker: string; defects: Defect[] };

function defectsOf(output: unknown): Defect[] {
  const listed = (output as { defects?: unknown } | undefined)?.defects;
  if (!Array.isArray(listed)) return [];
  return listed.filter(
    (item): item is Defect =>
      typeof (item as Defect | null)?.file === "string" &&
      typeof (item as Defect | null)?.problem === "string",
  );
}

// The earliest earlier step that wrote a file the defects name, or nothing:
// the work stays with the failing worker when it names no defect, or only
// files no earlier step wrote, since then its own tests may be what is wrong.
export function sendBackTarget(
  plan: Plan,
  currentStep: number,
  handoffs: Handoff[],
  outcome: CheckOutcome & { output?: unknown },
): SendBack | undefined {
  if (outcome.result !== "failed" || outcome.check !== "tests_pass") return undefined;
  const defects = defectsOf(outcome.output);
  const earlier = plan.steps.slice(0, currentStep).map(({ worker }) => worker);
  let target: number | undefined;
  for (const { file } of defects) {
    const writer = handoffs.findLast(
      ({ gate, artifacts }) => gate === "passed" && artifacts.includes(file),
    );
    const index = writer ? earlier.lastIndexOf(writer.sender) : -1;
    if (index >= 0 && (target === undefined || index < target)) target = index;
  }
  if (target === undefined) return undefined;
  return { step: target, worker: earlier[target] ?? "", defects };
}
