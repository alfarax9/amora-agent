import { type Agency, perform, type TurnOutcome } from "./agency.ts";
import type { Logger } from "./logger.ts";
import { redactSecrets } from "./secret-scanner.ts";
import { assertMove, type TaskStatus } from "./task-states.ts";
import {
  getTask,
  listHandoffs,
  type PlanStep,
  saveTask,
  spentSince,
  type Task,
} from "./task-store.ts";

// Dispatching a running task one step at a time, and every rule that stops it:
// pause, the task's budget, the daily limit, a blocked gate, and too many
// failed attempts (PRD §6.3, §11). The orchestrator is code, not a model.

export type Desk = {
  agency: Agency;
  logger: Logger;
  now: () => Date;
  // Tasks whose dispatch loop is running, so a task never runs twice at once.
  active: Set<string>;
};

// A refusal is meant for the owner, as is; any other error is a bug.
export class Refusal extends Error {}

export const usd = (amount: number) => `$${amount.toFixed(2)}`;

export function describe(outcome: TurnOutcome): string {
  return [outcome.reason, ...outcome.findings].join(" ");
}

export function load(desk: Desk, id: string): Task {
  const task = getTask(desk.agency.storage, id);
  if (!task) throw new Refusal(`There is no task ${id}.`);
  return task;
}

export function save(desk: Desk, task: Task): Task {
  return saveTask(desk.agency.storage, task, desk.now());
}

export function move(desk: Desk, task: Task, status: TaskStatus, reason?: string): Task {
  assertMove(task.status, status);
  const next: Task = { ...task, status };
  delete next.reason;
  return save(desk, reason ? { ...next, reason } : next);
}

export function dailyLimit(desk: Desk): number | undefined {
  return desk.agency.storage.getSetting<{ dailyUsd: number }>("budgets")?.dailyUsd;
}

// A model that cannot be reached, or a reply refused for holding a secret,
// says nothing about the work, so the task waits for the owner instead of
// failing. Error text is redacted before it is kept.
export function stopAfterError(desk: Desk, id: string, during: TaskStatus, error: unknown): Task {
  const task = load(desk, id);
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  desk.logger.warn("A step could not finish", { task: id, reason: message });
  if (task.status !== during) return task;
  return move(desk, task, "awaiting_decision", `The step could not finish: ${message}`);
}

function startOfDay(moment: Date): Date {
  const day = new Date(moment);
  day.setHours(0, 0, 0, 0);
  return day;
}

function stopReason(desk: Desk, task: Task): { status: TaskStatus; reason: string } | undefined {
  const { storage } = desk.agency;
  if (storage.getSetting<boolean>("paused")) {
    return { status: "paused", reason: "All workers are paused." };
  }
  if (task.spentUsd >= task.budgetUsd) {
    const reason = `The task reached its budget of ${usd(task.budgetUsd)}.`;
    return { status: "awaiting_decision", reason };
  }
  const daily = dailyLimit(desk);
  if (daily !== undefined && spentSince(storage, startOfDay(desk.now())) >= daily) {
    const reason = `Today's spend reached the daily limit of ${usd(daily)}.`;
    return { status: "awaiting_decision", reason };
  }
  return undefined;
}

// What a step's worker sees: the brief, its goal, what earlier steps
// delivered, and the findings of its own last failed attempt.
function stepInput(desk: Desk, task: Task, step: PlanStep) {
  const done = new Set(task.plan?.steps.slice(0, task.step).map((earlier) => earlier.worker));
  const delivered = new Map<string, unknown>();
  for (const handoff of listHandoffs(desk.agency.storage, task.id)) {
    if (handoff.gate === "passed" && done.has(handoff.sender)) {
      delivered.set(handoff.sender, handoff.content);
    }
  }
  return {
    brief: task.brief,
    plan: task.plan?.summary,
    goal: step.goal,
    earlier: [...delivered].map(([worker, output]) => ({ worker, output })),
    feedback: task.feedback,
  };
}

function attemptsFor(desk: Desk, workerId: string): number {
  const manifest = desk.agency.manifests.find(({ id }) => id === workerId);
  return Math.max(1, manifest?.budget.max_retries ?? 1);
}

// Applies a finished step to the task as it is now, which may have been
// cancelled while the step ran. Returns whether to dispatch again.
function settle(desk: Desk, id: string, step: PlanStep, outcome: TurnOutcome): boolean {
  const latest = load(desk, id);
  const task = { ...latest, spentUsd: latest.spentUsd + outcome.costUsd };
  if (task.status !== "running") return (save(desk, task), false);
  if (outcome.result === "passed") {
    save(desk, { ...task, step: task.step + 1, attempt: 0, feedback: [] });
    return true;
  }
  if (outcome.result === "blocked") {
    return (move(desk, task, "awaiting_decision", outcome.reason), false);
  }
  const failed = { ...task, attempt: task.attempt + 1, feedback: outcome.findings };
  if (failed.attempt < attemptsFor(desk, step.worker)) return (save(desk, failed), true);
  const reason = `${step.worker} did not pass its gate after ${failed.attempt} attempts. ${describe(outcome)}`;
  return (move(desk, failed, "awaiting_decision", reason), false);
}

async function advance(desk: Desk, id: string): Promise<boolean> {
  const task = load(desk, id);
  if (task.status !== "running" || !task.plan) return false;
  const stop = stopReason(desk, task);
  if (stop) return (move(desk, task, stop.status, stop.reason), false);
  const step = task.plan.steps[task.step];
  if (!step) {
    const reason = "Every step passed its gate. Approve to complete the task.";
    return (move(desk, task, "awaiting_decision", reason), false);
  }
  const outcome = await perform(desk.agency, {
    task,
    worker: step.worker,
    input: stepInput(desk, task, step),
    receiver: task.plan.steps[task.step + 1]?.worker ?? "owner",
    attempt: task.attempt + 1,
  });
  return settle(desk, id, step, outcome);
}

export async function drive(desk: Desk, id: string): Promise<void> {
  if (desk.active.has(id)) return;
  desk.active.add(id);
  try {
    while (await advance(desk, id));
  } catch (error) {
    stopAfterError(desk, id, "running", error);
  } finally {
    desk.active.delete(id);
  }
}
