import { type Agency, perform, taskWorkspace, type TurnOutcome } from "./agency.ts";
import type { Logger } from "./logger.ts";
import { formatUsd as usd } from "./money.ts";
import { matchesScope, scopesOf } from "./project-gates.ts";
import { redactSecrets } from "./secret-scanner.ts";
import { assertMove, type TaskStatus } from "./task-states.ts";
import {
  addMessage,
  getTask,
  listHandoffs,
  type PlanStep,
  saveTask,
  spentSince,
  type Task,
} from "./task-store.ts";
import { type SendBack, sendBackTarget } from "./send-back.ts";
import { type FileChange, projectView } from "./workspace.ts";

// Dispatching a running task one step at a time, and every rule that stops it:
// pause, the task's budget, the daily limit, a blocked gate, and too many
// failed attempts (PRD §6.3, §11). The orchestrator is code, not a model.

export type Desk = {
  agency: Agency;
  logger: Logger;
  now: () => Date;
  // Each task's background work, chained, so a task never runs twice at once
  // and work started while earlier work finishes is not lost.
  work: Map<string, Promise<void>>;
};

// A refusal is meant for the owner, as is; any other error is a bug.
export class Refusal extends Error {}

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

export function say(desk: Desk, id: string, author: "owner" | "agency", text: string): void {
  addMessage(desk.agency.storage, id, author, text, desk.now());
}

// What the agency tells the owner when a task reaches a state; moves the owner
// started themselves, such as approving, need no answer.
const announcements: Partial<Record<TaskStatus, string>> = {
  awaiting_plan_approval: "The plan is ready for your approval.",
  completed: "The task is complete.",
  cancelled: "The task was cancelled.",
};

export function move(desk: Desk, task: Task, status: TaskStatus, reason?: string): Task {
  assertMove(task.status, status);
  const next: Task = { ...task, status };
  delete next.reason;
  const saved = save(desk, reason ? { ...next, reason } : next);
  const text = reason ?? announcements[status];
  if (text) say(desk, task.id, "agency", text);
  return saved;
}

// Runs a task's work in the background after any work already running for it.
// A bug inside is logged, never left as an unhandled rejection.
export function startWork(desk: Desk, id: string, job: () => Promise<unknown>): void {
  const previous = desk.work.get(id) ?? Promise.resolve();
  const next = previous
    .then(job)
    .then(() => undefined)
    .catch((error: unknown) => {
      const reason = redactSecrets(error instanceof Error ? error.message : String(error));
      desk.logger.error("Task work failed", { task: id, reason });
    });
  desk.work.set(id, next);
  void next.then(() => {
    if (desk.work.get(id) === next) desk.work.delete(id);
  });
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

function delivered(desk: Desk, task: Task) {
  const done = new Set(task.plan?.steps.slice(0, task.step).map((earlier) => earlier.worker));
  const outputs = new Map<string, unknown>();
  for (const handoff of listHandoffs(desk.agency.storage, task.id)) {
    if (handoff.gate === "passed" && done.has(handoff.sender)) {
      outputs.set(handoff.sender, handoff.content);
    }
  }
  return [...outputs].map(([worker, output]) => ({ worker, output }));
}

// What a step's worker sees: the brief, its goal, the paths it may write, what
// earlier steps delivered and what later steps will, the project as it stands
// in the task's workspace, and the findings of its own last failed attempt.
// The first real run showed why `area` and `later` matter: without them,
// workers wrote the tests the plan gave to the Tester, and the reviewer
// returned work for leaving them out.
function stepInput(desk: Desk, task: Task, step: PlanStep) {
  const workspace = taskWorkspace(desk.agency, task);
  const manifest = desk.agency.manifests.find(({ id }) => id === step.worker);
  const area = manifest ? scopesOf(manifest) : [];
  const inArea = (path: string) => area.some((scope) => matchesScope(path, scope));
  const later = (task.plan?.steps ?? []).slice(task.step + 1);
  return {
    brief: task.brief,
    plan: task.plan?.summary,
    goal: step.goal,
    area,
    earlier: delivered(desk, task),
    later: later.map(({ worker, goal }) => ({ worker: roleOf(desk, worker), goal })),
    ...(workspace ? { project: projectView(workspace, inArea) } : {}),
    feedback: task.feedback,
  };
}

function attemptsFor(desk: Desk, workerId: string): number {
  const manifest = desk.agency.manifests.find(({ id }) => id === workerId);
  return Math.max(1, manifest?.budget.max_retries ?? 1);
}

function roleOf(desk: Desk, workerId: string): string {
  return desk.agency.manifests.find(({ id }) => id === workerId)?.role ?? workerId;
}

// What the code worker hears when its work comes back: the defects, the test
// run's output, and the tests themselves, which it may not change.
function returnedFeedback(tester: string, back: SendBack, outcome: TurnOutcome): string[] {
  const tests = (outcome.output as { files?: FileChange[] } | undefined)?.files ?? [];
  return [
    `${tester}'s tests fail on your code. Fix the code so they pass; the tests stay as they are.`,
    ...back.defects.map(({ file, problem }) => `${file}: ${problem}`),
    ...outcome.findings,
    ...tests.map(({ path, content }) => `Test file ${path}:\n${content.slice(0, 4000)}`),
  ];
}

// Sends the work back to the step that wrote the faulty code; the steps after
// it run again on the fixed code. A task does this at most as often as the
// failing worker may attempt its own step, then asks the owner.
function sendBack(desk: Desk, task: Task, step: PlanStep, back: SendBack, outcome: TurnOutcome) {
  const tester = roleOf(desk, step.worker);
  const files = [...new Set(back.defects.map(({ file }) => file))].join(", ");
  if (task.returns >= attemptsFor(desk, step.worker)) {
    const reason = `${tester} still finds defects in ${files} after the work went back ${task.returns} times. ${describe(outcome)}`;
    return (move(desk, task, "awaiting_decision", reason), false);
  }
  say(
    desk,
    task.id,
    "agency",
    `${tester} found a defect in ${files}; the work goes back to ${roleOf(desk, back.worker)}.`,
  );
  const feedback = returnedFeedback(tester, back, outcome);
  save(desk, { ...task, step: back.step, attempt: 0, returns: task.returns + 1, feedback });
  return true;
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
  const handoffs = listHandoffs(desk.agency.storage, id);
  const back = task.plan && sendBackTarget(task.plan, task.step, handoffs, outcome);
  if (back) return sendBack(desk, task, step, back, outcome);
  // The reason names the check that failed; the findings say what it found.
  const feedback = [outcome.reason, ...outcome.findings];
  const failed = { ...task, attempt: task.attempt + 1, feedback };
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
  try {
    while (await advance(desk, id));
  } catch (error) {
    stopAfterError(desk, id, "running", error);
  }
}
