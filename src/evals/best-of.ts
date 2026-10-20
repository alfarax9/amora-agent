import type { Meter } from "./meter.ts";
import type { SystemRun } from "./single-agent.ts";

// Parallel attempts (Orca fans one prompt out to several agents and keeps the
// winner): a heavy task runs twice at once, each attempt on its own copy, and
// the one whose gates all passed is kept, the cheaper when both did. Choosing
// looks only at AMORA's own gates, never at the hidden test, and the cost is
// both attempts', so the benchmark says whether the second try pays for itself.

export type Attempt = SystemRun & { project: string; meter: Meter };

export function bestOf<T extends Attempt>(attempts: T[]): T {
  const [first] = attempts;
  if (!first) throw new Error("bestOf needs at least one attempt.");
  const passed = attempts
    .filter(({ delivered }) => delivered)
    .sort((a, b) => a.meter.costUsd - b.meter.costUsd);
  return passed[0] ?? first;
}

export function addMeter(total: Meter, part: Meter): void {
  total.calls += part.calls;
  total.tokensIn += part.tokensIn;
  total.tokensOut += part.tokensOut;
  total.costUsd += part.costUsd;
}
