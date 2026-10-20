import { formatUsd as usd } from "./money.ts";
import { type Orchestrator, Refusal } from "./orchestrator.ts";
import type { Storage } from "./storage.ts";
import { getTask, listMessages, type Task } from "./task-store.ts";

// `amora run`: a task from a script, a CI job, or another agent (Orca drives
// agents the same way), with no dashboard. It plans, and with the owner's
// flags approves and completes, then says how far it got: the exit code is 0
// when it reached the stage asked for, 1 when it needs a decision or was
// refused, and 3 when it paused for a provider's quota.

export type HeadlessOptions = {
  brief: string;
  budgetUsd: number;
  project: string;
  approve: boolean;
  complete: boolean;
};

export type HeadlessResult = { code: number; task?: Task; report: string };

const finishedStep = (task: Task) =>
  task.status === "awaiting_decision" && !!task.plan && task.step >= task.plan.steps.length;

// The exit code once the work for the stages asked for has settled.
function codeOf(task: Task, options: HeadlessOptions): number {
  if (task.status === "paused") return 3;
  if (task.status === "completed") return 0;
  // With --approve, a refused approval has already answered 1.
  if (task.status === "awaiting_plan_approval") return 0;
  if (finishedStep(task)) return options.complete ? 1 : 0;
  return 1;
}

function planReady(task: Task): string {
  const estimate = task.plan?.estimate;
  const cost =
    estimate && estimate.unpriced.length === 0 ? ` Estimated at ${usd(estimate.usd)}.` : "";
  return `The plan is ready for approval.${cost} Approve it in the dashboard or run again with --approve.`;
}

// What the run reached, in one sentence for the caller.
function stage(task: Task): string {
  if (task.status === "completed") return "The task is complete.";
  if (task.status === "paused") return `Paused until ${task.resumeAt ?? "the owner resumes it"}.`;
  if (task.status === "awaiting_plan_approval") return planReady(task);
  if (finishedStep(task)) {
    return "Every step passed its gate. Complete it in the dashboard, or run with --complete.";
  }
  return task.reason ?? task.status;
}

// Says each new transcript message once, and returns the task as it is now.
function follower(storage: Storage, say: (line: string) => void) {
  let shown = 0;
  return (id: string) => {
    const messages = listMessages(storage, id);
    for (const { author, text } of messages.slice(shown)) {
      say(`${author === "owner" ? "You" : "AMORA"}: ${text}`);
    }
    shown = messages.length;
    return getTask(storage, id);
  };
}

type Follow = ReturnType<typeof follower>;

async function stages(
  orchestrator: Orchestrator,
  id: string,
  options: HeadlessOptions,
  follow: Follow,
) {
  await orchestrator.settled(id);
  if (options.approve && follow(id)?.status === "awaiting_plan_approval") {
    await orchestrator.approve(id);
    await orchestrator.settled(id);
  }
  const ran = follow(id);
  if (options.complete && ran && finishedStep(ran)) orchestrator.decide(id, { action: "complete" });
}

const refused = (error: unknown, task?: Task): HeadlessResult => {
  if (!(error instanceof Refusal)) throw error;
  return { code: 1, ...(task ? { task } : {}), report: error.message };
};

export async function runHeadless(
  orchestrator: Orchestrator,
  storage: Storage,
  options: HeadlessOptions,
  say: (line: string) => void,
): Promise<HeadlessResult> {
  const follow = follower(storage, say);
  let id: string;
  try {
    id = orchestrator.create(options.brief, options.budgetUsd, options.project).id;
  } catch (error) {
    return refused(error);
  }
  try {
    await stages(orchestrator, id, options, follow);
  } catch (error) {
    return refused(error, follow(id));
  }
  const final = follow(id);
  if (!final) return { code: 1, report: "The task is gone." };
  return { code: codeOf(final, options), task: final, report: stage(final) };
}
