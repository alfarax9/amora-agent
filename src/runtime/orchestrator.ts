import { type Agency, perform } from "./agency.ts";
import {
  dailyLimit,
  describe,
  type Desk,
  drive,
  load,
  move,
  Refusal,
  save,
  stopAfterError,
  usd,
} from "./dispatch.ts";
import type { Logger } from "./logger.ts";
import { isFinished } from "./task-states.ts";
import { createTask, listTasks, type Plan, type Task } from "./task-store.ts";

// The task lifecycle the owner drives (PRD §4): a brief becomes a plan, the
// owner approves it, workers run it, and every stop waits for the owner's
// decision. Dispatching itself is in dispatch.ts.

const plannerId = "planner-decomposer";

export { Refusal };

type Decision =
  { action: "retry"; budgetUsd?: number } | { action: "complete" } | { action: "cancel" };

export type Orchestrator = {
  create(brief: string, budgetUsd: number): Task;
  plan(id: string): Promise<Task>;
  approve(id: string): Promise<Task>;
  decide(id: string, decision: Decision): Promise<Task>;
  cancel(id: string): Task;
  pauseAll(): void;
  resumeAll(): Promise<void>;
};

// Reviewers work through gates, so the Planner is only offered the workers
// that produce something.
function roster(agency: Agency) {
  return agency.manifests
    .filter(({ id, output_contract }) => id !== plannerId && output_contract !== "review.v1")
    .map(({ id, role, mission }) => ({ id, role, mission }));
}

function checkPlan(output: unknown, known: Set<string>): string[] {
  const plan = output as Plan;
  const problems = plan.steps.length === 0 ? ["/steps has no steps."] : [];
  for (const [index, step] of plan.steps.entries()) {
    if (!known.has(step.worker)) {
      problems.push(`/steps/${index}/worker "${step.worker}" is not one of the workers given.`);
    }
  }
  if (plan.estimate_usd < 0) problems.push("/estimate_usd must not be negative.");
  return problems;
}

async function plan(desk: Desk, id: string): Promise<Task> {
  const task = load(desk, id);
  if (task.status !== "planning") throw new Refusal("This task is not being planned.");
  const workers = roster(desk.agency);
  const known = new Set(workers.map((worker) => worker.id));
  try {
    const outcome = await perform(desk.agency, {
      task,
      worker: plannerId,
      input: { brief: task.brief, workers, feedback: task.feedback },
      receiver: "owner",
      attempt: 1,
      check: (output) => checkPlan(output, known),
    });
    const latest = load(desk, id);
    const spent = { ...latest, spentUsd: latest.spentUsd + outcome.costUsd };
    if (latest.status !== "planning") return save(desk, spent);
    if (outcome.result !== "passed") {
      return move(desk, spent, "awaiting_decision", `The plan is not ready. ${describe(outcome)}`);
    }
    return move(
      desk,
      { ...spent, plan: outcome.output as Plan, feedback: [] },
      "awaiting_plan_approval",
    );
  } catch (error) {
    return stopAfterError(desk, id, "planning", error);
  }
}

// The plan preview is the budget check (PRD §8 rule 3): nothing starts without
// a daily limit, or with an estimate above the task's budget.
async function approve(desk: Desk, id: string): Promise<Task> {
  const task = load(desk, id);
  if (task.status !== "awaiting_plan_approval" || !task.plan) {
    throw new Refusal("Only a task waiting for plan approval can be approved.");
  }
  if (dailyLimit(desk) === undefined) {
    throw new Refusal("Set a daily budget before approving a task: amora budget --daily <usd>");
  }
  if (task.plan.estimate_usd > task.budgetUsd) {
    const estimate = usd(task.plan.estimate_usd);
    throw new Refusal(
      `The plan is estimated at ${estimate}, more than the task's budget of ${usd(task.budgetUsd)}. Raise the budget or ask for a smaller plan.`,
    );
  }
  move(desk, task, "running");
  await drive(desk, id);
  return load(desk, id);
}

async function decide(desk: Desk, id: string, decision: Decision): Promise<Task> {
  const task = load(desk, id);
  if (task.status !== "awaiting_decision") {
    throw new Refusal("This task is not waiting for a decision.");
  }
  if (decision.action === "cancel") return move(desk, task, "cancelled");
  if (decision.action === "complete") {
    if (!task.plan || task.step < task.plan.steps.length) {
      throw new Refusal("Only a task whose every step passed its gate can be completed.");
    }
    return move(desk, task, "completed");
  }
  // A retry keeps the last findings, so the next attempt knows what failed.
  const next = { ...task, budgetUsd: decision.budgetUsd ?? task.budgetUsd, attempt: 0 };
  if (!task.plan) return (move(desk, next, "planning"), plan(desk, id));
  move(desk, next, "running");
  await drive(desk, id);
  return load(desk, id);
}

async function resumeAll(desk: Desk): Promise<void> {
  desk.agency.storage.setSetting("paused", false);
  const paused = listTasks(desk.agency.storage).filter((task) => task.status === "paused");
  for (const task of paused) move(desk, task, "running");
  await Promise.all(paused.map((task) => drive(desk, task.id)));
}

export function createOrchestrator(
  agency: Agency,
  { logger, now = () => new Date() }: { logger: Logger; now?: () => Date },
): Orchestrator {
  const desk: Desk = { agency, logger, now, active: new Set() };
  return {
    create(brief, budgetUsd) {
      if (!(budgetUsd > 0)) throw new Refusal("A task needs a budget above $0.");
      return createTask(agency.storage, brief, budgetUsd, now());
    },
    plan: (id) => plan(desk, id),
    approve: (id) => approve(desk, id),
    decide: (id, decision) => decide(desk, id, decision),
    cancel(id) {
      const task = load(desk, id);
      if (isFinished(task.status)) throw new Refusal("This task has already finished.");
      return move(desk, task, "cancelled");
    },
    // In-flight calls finish and are recorded; nothing new is dispatched.
    pauseAll: () => agency.storage.setSetting("paused", true),
    resumeAll: () => resumeAll(desk),
  };
}
