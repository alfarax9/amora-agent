import { type Agency, perform, taskWorkspace } from "./agency.ts";
import {
  dailyLimit,
  describe,
  type Desk,
  drive,
  load,
  move,
  Refusal,
  save,
  say,
  startWork,
  stopAfterError,
} from "./dispatch.ts";
import type { Logger } from "./logger.ts";
import { formatUsd as usd } from "./money.ts";
import { briefContract, plannerId } from "./roster.ts";
import { isFinished } from "./task-states.ts";
import { estimatePlan } from "./estimate.ts";
import {
  createTask,
  type Estimate,
  listHandoffs,
  listTasks,
  type Plan,
  type Task,
} from "./task-store.ts";
import { deliver } from "./workspace.ts";

// The task lifecycle the owner drives (PRD §4): a brief becomes a plan, the
// owner approves it, workers run it, and every stop waits for the owner's
// decision. Dispatching itself is in dispatch.ts.

export { Refusal };

export type Decision =
  { action: "retry"; budgetUsd?: number } | { action: "complete" } | { action: "cancel" };

// Every call checks the request and answers at once; the work it starts runs
// in the background, and `settled` waits for a task's work to finish.
export type Orchestrator = {
  create(brief: string, budgetUsd: number, project?: string): Task;
  approve(id: string): Promise<Task>;
  revise(id: string, feedback: string): Task;
  decide(id: string, decision: Decision): Task;
  cancel(id: string): Task;
  pauseAll(): void;
  resumeAll(): void;
  recoverInterrupted(): void;
  settled(id: string): Promise<void>;
};

// Reviewers work through gates, so the Planner is only offered the workers
// that produce something, with what each needs and delivers so it can order
// them.
function roster(agency: Agency, offeredIds: string[] | undefined) {
  const offered = (id: string) => offeredIds?.includes(id) ?? true;
  return agency.manifests
    .filter(({ id, output_contract }) => id !== plannerId && output_contract !== "review.v1")
    .filter(({ id }) => offered(id))
    .map(({ id, role, mission, input_contract, output_contract }) => ({
      id,
      role,
      mission,
      needs: input_contract,
      delivers: output_contract,
    }));
}

type RosterEntry = ReturnType<typeof roster>[number];

// The plan is checked by code before the owner sees it: every worker exists,
// and each one comes after a worker that delivers what it needs.
function checkPlan(output: unknown, workers: RosterEntry[]): string[] {
  const plan = output as Plan;
  const problems = plan.steps.length === 0 ? ["/steps has no steps."] : [];
  const delivered = new Set([briefContract]);
  for (const [index, step] of plan.steps.entries()) {
    const worker = workers.find(({ id }) => id === step.worker);
    if (!worker) {
      problems.push(`/steps/${index}/worker "${step.worker}" is not one of the workers given.`);
    } else if (!delivered.has(worker.needs)) {
      problems.push(
        `/steps/${index} ${worker.id} needs ${worker.needs}, which no earlier step delivers.`,
      );
    }
    if (worker) delivered.add(worker.delivers);
  }
  return problems;
}

async function plan(desk: Desk, id: string): Promise<Task> {
  const task = load(desk, id);
  if (task.status !== "planning") throw new Refusal("This task is not being planned.");
  const choice = desk.agency.roster?.(task.brief) ?? { offered: undefined };
  const workers = roster(desk.agency, choice.offered);
  // Said once, on the first plan; a revision keeps the same brief and roster.
  if (choice.note && task.feedback.length === 0) say(desk, id, "agency", choice.note);
  try {
    const outcome = await perform(desk.agency, {
      task,
      worker: plannerId,
      input: { brief: task.brief, workers, feedback: task.feedback },
      receiver: "owner",
      attempt: 1,
      check: (output) => checkPlan(output, workers),
    });
    const latest = load(desk, id);
    const spent = { ...latest, spentUsd: latest.spentUsd + outcome.costUsd };
    if (latest.status !== "planning") return save(desk, spent);
    if (outcome.result !== "passed") {
      return move(desk, spent, "awaiting_decision", `The plan is not ready. ${describe(outcome)}`);
    }
    const drafted = outcome.output as Plan;
    const estimate = await estimatePlan(desk.agency, drafted.steps);
    const planned = { ...load(desk, id), spentUsd: spent.spentUsd };
    if (planned.status !== "planning") return save(desk, planned);
    const withPlan = { ...planned, plan: { ...drafted, estimate }, feedback: [] };
    return move(desk, withPlan, "awaiting_plan_approval");
  } catch (error) {
    return stopAfterError(desk, id, "planning", error);
  }
}

// Says why a plan's estimate cannot be approved, or nothing when it can. An
// unknown price is a reason: guessing it would make the budget check a guess.
function estimateProblem(task: Task, estimate: Estimate): string | undefined {
  if (estimate.unpriced.length > 0) {
    const models = estimate.unpriced.join(", ");
    return `No price is known for ${models}, so the plan has no estimate. State each with: amora models price <model> <input> <output> (USD per million tokens; 0 for a subscription).`;
  }
  if (estimate.usd > task.budgetUsd) {
    return `The plan is estimated at ${usd(estimate.usd)}, more than the task's budget of ${usd(task.budgetUsd)}. Raise the budget or ask for a smaller plan.`;
  }
  return undefined;
}

// The plan preview is the budget check (PRD §8 rule 3): nothing starts without
// a daily limit, or without an estimate within the task's budget. The estimate
// is worked out again here, so a price stated after planning counts.
async function approve(desk: Desk, id: string): Promise<Task> {
  const task = load(desk, id);
  if (task.status !== "awaiting_plan_approval" || !task.plan) {
    throw new Refusal("Only a task waiting for plan approval can be approved.");
  }
  if (dailyLimit(desk) === undefined) {
    throw new Refusal("Set a daily budget before approving a task: amora budget --daily <usd>");
  }
  const estimate = await estimatePlan(desk.agency, task.plan.steps);
  const latest = load(desk, id);
  if (latest.status !== "awaiting_plan_approval" || !latest.plan) {
    throw new Refusal("Only a task waiting for plan approval can be approved.");
  }
  const priced = save(desk, { ...latest, plan: { ...latest.plan, estimate } });
  const problem = estimateProblem(priced, estimate);
  if (problem) throw new Refusal(problem);
  say(desk, id, "owner", "Approved the plan.");
  const running = move(desk, priced, "running");
  startWork(desk, id, () => drive(desk, id));
  return running;
}

// The owner's answer to a plan they do not want as it is: the Planner drafts
// it again with their words as feedback.
function revise(desk: Desk, id: string, feedback: string): Task {
  const task = load(desk, id);
  if (task.status !== "awaiting_plan_approval") {
    throw new Refusal("Only a plan waiting for approval can be revised.");
  }
  say(desk, id, "owner", feedback);
  const planning = move(desk, { ...task, feedback: [feedback] }, "planning");
  startWork(desk, id, () => plan(desk, id));
  return planning;
}

function retry(desk: Desk, task: Task, budgetUsd: number | undefined): Task {
  const budget = budgetUsd ?? task.budgetUsd;
  if (!(budget > 0)) throw new Refusal("A task needs a budget above $0.");
  const raised = budget === task.budgetUsd ? "" : ` with a budget of ${usd(budget)}`;
  say(desk, task.id, "owner", `Try again${raised}.`);
  // A retry keeps the last findings, so the next attempt knows what failed.
  const next = { ...task, budgetUsd: budget, attempt: 0 };
  const status = task.plan ? "running" : "planning";
  const moved = move(desk, next, status);
  startWork(desk, task.id, () => (task.plan ? drive(desk, task.id) : plan(desk, task.id)));
  return moved;
}

// The owner's folder changes only here, when they complete the task: the files
// every passed step wrote are copied from the task's workspace (PRD §4 step 7).
function complete(desk: Desk, task: Task): Task {
  if (!task.plan || task.step < task.plan.steps.length) {
    throw new Refusal("Only a task whose every step passed its gate can be completed.");
  }
  say(desk, task.id, "owner", "Complete the task.");
  const workspace = taskWorkspace(desk.agency, task);
  if (workspace && task.project) {
    const written = listHandoffs(desk.agency.storage, task.id)
      .filter(({ gate }) => gate === "passed")
      .flatMap(({ artifacts }) => artifacts);
    const delivered = deliver(workspace, task.project, written);
    if (delivered.length > 0) {
      say(
        desk,
        task.id,
        "agency",
        `Wrote ${delivered.length} files to ${task.project}: ${delivered.join(", ")}`,
      );
    }
  }
  return move(desk, task, "completed");
}

function decide(desk: Desk, id: string, decision: Decision): Task {
  const task = load(desk, id);
  if (task.status !== "awaiting_decision") {
    throw new Refusal("This task is not waiting for a decision.");
  }
  if (decision.action === "retry") return retry(desk, task, decision.budgetUsd);
  if (decision.action === "complete") return complete(desk, task);
  say(desk, id, "owner", "Cancel the task.");
  return move(desk, task, "cancelled");
}

function resumeAll(desk: Desk): void {
  desk.agency.storage.setSetting("paused", false);
  for (const task of listTasks(desk.agency.storage)) {
    if (task.status !== "paused") continue;
    move(desk, task, "running");
    startWork(desk, task.id, () => drive(desk, task.id));
  }
}

// Work runs inside this process, so a task left planning or running by an
// earlier process has nobody working on it. It waits for the owner instead of
// looking busy forever; trying again picks it up where it stopped.
function recoverInterrupted(desk: Desk): void {
  for (const task of listTasks(desk.agency.storage)) {
    if (task.status !== "planning" && task.status !== "running") continue;
    const reason = "AMORA stopped while this task was working. Try again to continue.";
    move(desk, task, "awaiting_decision", reason);
  }
}

export function createOrchestrator(
  agency: Agency,
  { logger, now = () => new Date() }: { logger: Logger; now?: () => Date },
): Orchestrator {
  const desk: Desk = { agency, logger, now, work: new Map() };
  return {
    create(brief, budgetUsd, project) {
      if (!(budgetUsd > 0)) throw new Refusal("A task needs a budget above $0.");
      const task = createTask(agency.storage, brief, budgetUsd, now(), project);
      say(desk, task.id, "owner", brief);
      startWork(desk, task.id, () => plan(desk, task.id));
      return task;
    },
    approve: (id) => approve(desk, id),
    revise: (id, feedback) => revise(desk, id, feedback),
    decide: (id, decision) => decide(desk, id, decision),
    cancel(id) {
      const task = load(desk, id);
      if (isFinished(task.status)) throw new Refusal("This task has already finished.");
      say(desk, id, "owner", "Cancel the task.");
      return move(desk, task, "cancelled");
    },
    // In-flight calls finish and are recorded; nothing new is dispatched.
    pauseAll: () => agency.storage.setSetting("paused", true),
    resumeAll: () => resumeAll(desk),
    recoverInterrupted: () => recoverInterrupted(desk),
    settled: async (id) => {
      while (desk.work.has(id)) await desk.work.get(id);
    },
  };
}
