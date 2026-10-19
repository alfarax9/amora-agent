import { formatUsd as usd } from "../runtime/money.ts";
import { spentSince } from "../runtime/task-store.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

type Budgets = { dailyUsd: number };

// The daily limit applies across every task (PRD §11). No task can be approved
// until one is set, so spending always has a ceiling the owner chose.
export function runBudget(context: AppContext, daily: string | undefined): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const spent = spentSince(context.storage, today);
  if (daily === undefined) {
    const current = context.storage.getSetting<Budgets>("budgets")?.dailyUsd;
    print(
      current === undefined
        ? "No daily limit is set yet, so no task can be approved. Set one: amora budget --daily <usd>"
        : `Daily limit ${usd(current)}; spent today ${usd(spent)}.`,
    );
    return true;
  }
  const amount = Number(daily);
  if (!Number.isFinite(amount) || amount <= 0) {
    printError("--daily must be an amount in USD above 0, such as 1 or 0.50.");
    return false;
  }
  context.storage.setSetting("budgets", { dailyUsd: amount } satisfies Budgets);
  print(`Daily limit set to ${usd(amount)}; spent today ${usd(spent)}.`);
  print("Free models cost $0, so with free mode the limit only matters once you add paid ones.");
  return true;
}
