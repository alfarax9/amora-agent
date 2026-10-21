import {
  type KeyLimit,
  KeyLimitError,
  type LimitChange,
  limitResets,
  readKeyLimit,
  setKeyLimit,
} from "../model-layer/key-limit.ts";
import { formatUsd as usd } from "../runtime/money.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";
import { readSecret } from "./secret-prompt.ts";

// The OpenRouter key's own credit limit (key-limit.ts), the ceiling OpenRouter
// keeps whatever AMORA counts. The management key that changes it is typed at
// a hidden prompt and used for this one change only.

export function describeLimit(limit: KeyLimit): string {
  if (limit.limitUsd === null) {
    return `Key ${limit.label} has no credit limit; spent ${usd(limit.usageUsd)} in all. Set one: amora credit-limit <usd>`;
  }
  const reset = limit.reset ? `, resets ${limit.reset} at midnight UTC` : ", never resets";
  const left = limit.remainingUsd === null ? "" : `, ${usd(limit.remainingUsd)} left`;
  return `Key ${limit.label} has a credit limit of ${usd(limit.limitUsd)}${reset}${left}; spent today ${usd(limit.usageTodayUsd)}.`;
}

// A string is what is wrong with the arguments.
export function parseLimitChange(
  amount: string | undefined,
  reset: string | undefined,
): LimitChange | string {
  const change: LimitChange = {};
  if (amount !== undefined) {
    const value = Number(amount);
    if (amount !== "none" && !(Number.isFinite(value) && value > 0)) {
      return "The limit must be an amount in USD above 0, such as 2 or 0.50, or none.";
    }
    change.limitUsd = amount === "none" ? null : value;
  }
  if (reset !== undefined) {
    const found = limitResets.find((name) => name === reset);
    if (!found && reset !== "never") return "--reset must be daily, weekly, monthly, or never.";
    change.reset = found ?? null;
  }
  return change;
}

async function changeLimit(key: string, change: LimitChange): Promise<boolean> {
  const managementKey = await readSecret("OpenRouter management key (typing is hidden): ");
  if (!managementKey) return (printError("No key entered, so nothing changed."), false);
  try {
    print(describeLimit(await setKeyLimit(key, managementKey, change)));
  } catch (error) {
    if (!(error instanceof KeyLimitError)) throw error;
    printError(`${error.message} Nothing changed.`);
    return false;
  }
  print("The management key was used for this change only and was not stored.");
  return true;
}

export async function runCreditLimit(
  context: AppContext,
  amount: string | undefined,
  reset: string | undefined,
): Promise<boolean> {
  const key = await context.secrets.get("openrouter");
  if (!key)
    return (
      printError("Connect OpenRouter first: run amora and choose Connect OpenRouter."),
      false
    );
  if (amount === undefined && reset === undefined) {
    return (print(describeLimit(await readKeyLimit(key))), true);
  }
  const change = parseLimitChange(amount, reset);
  if (typeof change === "string") return (printError(change), false);
  return changeLimit(key, change);
}
