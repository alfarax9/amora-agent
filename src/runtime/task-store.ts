import { randomUUID } from "node:crypto";
import { refuseSecrets, type Storage } from "./storage.ts";
import type { TaskStatus } from "./task-states.ts";

// Tasks and the handoff log (PRD §6.2). Every text goes through refuseSecrets
// before it is written (S6): a brief, a plan, a model's output, or a
// reviewer's findings can all carry a key someone pasted.

// `acceptance` is the observable evidence that a step is done; plans drafted
// before it existed have none.
export type PlanStep = { worker: string; goal: string; acceptance?: string };
// Computed by the runtime from model prices, never by a model: `unpriced`
// names the models whose price nobody knows yet.
export type Estimate = { usd: number; unpriced: string[] };
export type Plan = { summary: string; steps: PlanStep[]; estimate?: Estimate };

export type Task = {
  id: string;
  brief: string;
  status: TaskStatus;
  budgetUsd: number;
  spentUsd: number;
  plan?: Plan;
  step: number;
  attempt: number;
  // The last gate's findings, sent with the next attempt of the same step.
  feedback: string[];
  // How often a test run sent the work back to an earlier step; capped.
  returns: number;
  reason?: string;
  project?: string;
  // Set while the task waits for a provider's quota: when it resumes itself.
  resumeAt?: string;
  // Quota waits in a row; a passed step or plan starts the count again.
  quotaWaits: number;
  createdAt: string;
  updatedAt: string;
};

export type Validation = "valid" | "repaired" | "invalid";
type GateResult = "passed" | "failed" | "blocked" | "none";

export type Handoff = {
  taskId: string;
  sender: string;
  receiver: string;
  contract: string;
  validation: Validation;
  gate: GateResult;
  gateReason: string;
  model: string;
  answeredBy: string;
  attempt: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  content: unknown;
  artifacts: string[];
};

type TaskRow = {
  id: string;
  brief: string;
  status: TaskStatus;
  budget_usd: number;
  spent_usd: number;
  plan: string | null;
  step: number;
  attempt: number;
  feedback: string;
  returns: number;
  reason: string | null;
  project: string | null;
  resume_at: string | null;
  quota_waits: number;
  created_at: string;
  updated_at: string;
};

// Plans made before the Frontend Engineer became the Software Engineer name
// the old id; they resume with the worker it became.
const renamedWorkers: Record<string, string> = { "fe-engineer": "software-engineer" };

function currentNames(plan: Plan): Plan {
  const steps = plan.steps.map((step) => ({
    ...step,
    worker: renamedWorkers[step.worker] ?? step.worker,
  }));
  return { ...plan, steps };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    brief: row.brief,
    status: row.status,
    budgetUsd: row.budget_usd,
    spentUsd: row.spent_usd,
    ...(row.plan === null ? {} : { plan: currentNames(JSON.parse(row.plan) as Plan) }),
    step: row.step,
    attempt: row.attempt,
    feedback: JSON.parse(row.feedback) as string[],
    returns: row.returns,
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.project === null ? {} : { project: row.project }),
    ...(row.resume_at === null ? {} : { resumeAt: row.resume_at }),
    quotaWaits: row.quota_waits,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTask(
  storage: Storage,
  brief: string,
  budgetUsd: number,
  now = new Date(),
  project?: string,
) {
  refuseSecrets(brief, "a task brief");
  const at = now.toISOString();
  const task: Task = {
    id: randomUUID(),
    brief,
    status: "planning",
    budgetUsd,
    spentUsd: 0,
    step: 0,
    attempt: 0,
    feedback: [],
    returns: 0,
    quotaWaits: 0,
    ...(project === undefined ? {} : { project }),
    createdAt: at,
    updatedAt: at,
  };
  storage.database
    .prepare(
      `INSERT INTO tasks (id, brief, status, budget_usd, spent_usd, plan, step, attempt, feedback,
       reason, project, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, NULL, 0, 0, '[]', NULL, ?, ?, ?)`,
    )
    .run(task.id, brief, task.status, budgetUsd, project ?? null, at, at);
  return task;
}

export function getTask(storage: Storage, id: string): Task | undefined {
  const row = storage.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return row ? toTask(row as TaskRow) : undefined;
}

export function listTasks(storage: Storage): Task[] {
  const rows = storage.database.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all();
  return (rows as TaskRow[]).map(toTask);
}

export function saveTask(storage: Storage, task: Task, now = new Date()): Task {
  const plan = task.plan ? JSON.stringify(task.plan) : null;
  const feedback = JSON.stringify(task.feedback);
  refuseSecrets(`${plan ?? ""}\n${feedback}\n${task.reason ?? ""}`, "a task");
  const saved = { ...task, updatedAt: now.toISOString() };
  storage.database
    .prepare(
      `UPDATE tasks SET status = ?, budget_usd = ?, spent_usd = ?, plan = ?, step = ?, attempt = ?,
       feedback = ?, returns = ?, reason = ?, resume_at = ?, quota_waits = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      saved.status,
      saved.budgetUsd,
      saved.spentUsd,
      plan,
      saved.step,
      saved.attempt,
      feedback,
      saved.returns,
      saved.reason ?? null,
      saved.resumeAt ?? null,
      saved.quotaWaits,
      saved.updatedAt,
      saved.id,
    );
  return saved;
}

export function recordHandoff(storage: Storage, handoff: Handoff, now = new Date()): void {
  const content = JSON.stringify(handoff.content);
  refuseSecrets(`${content}\n${handoff.gateReason}`, `a handoff from ${handoff.sender}`);
  storage.database
    .prepare(
      `INSERT INTO handoffs (task_id, sender, receiver, contract, validation, gate, gate_reason, model,
       answered_by, attempt, tokens_in, tokens_out, cost_usd, content, artifacts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      handoff.taskId,
      handoff.sender,
      handoff.receiver,
      handoff.contract,
      handoff.validation,
      handoff.gate,
      handoff.gateReason,
      handoff.model,
      handoff.answeredBy,
      handoff.attempt,
      handoff.tokensIn,
      handoff.tokensOut,
      handoff.costUsd,
      content,
      JSON.stringify(handoff.artifacts),
      now.toISOString(),
    );
}

type HandoffRow = {
  task_id: string;
  sender: string;
  receiver: string;
  contract: string;
  validation: Validation;
  gate: GateResult;
  gate_reason: string;
  model: string;
  answered_by: string;
  attempt: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  content: string;
  artifacts: string;
  created_at: string;
};

// As stored, with when it was recorded, so a transcript can place it.
export type StoredHandoff = Handoff & { createdAt: string };

function toHandoff(row: HandoffRow): StoredHandoff {
  return {
    taskId: row.task_id,
    sender: row.sender,
    receiver: row.receiver,
    contract: row.contract,
    validation: row.validation,
    gate: row.gate,
    gateReason: row.gate_reason,
    model: row.model,
    answeredBy: row.answered_by,
    attempt: row.attempt,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costUsd: row.cost_usd,
    content: JSON.parse(row.content) as unknown,
    artifacts: JSON.parse(row.artifacts) as string[],
    createdAt: row.created_at,
  };
}

export function listHandoffs(storage: Storage, taskId: string): StoredHandoff[] {
  const rows = storage.database
    .prepare("SELECT * FROM handoffs WHERE task_id = ? ORDER BY id")
    .all(taskId);
  return (rows as HandoffRow[]).map(toHandoff);
}

// Spend across every task since a moment, for the daily limit (PRD §11).
export function spentSince(storage: Storage, since: Date): number {
  const row = storage.database
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM handoffs WHERE created_at >= ?")
    .get(since.toISOString()) as { total: number };
  return row.total;
}

// The chat transcript of a task (PRD §8 rule 4): what the owner asked and
// decided, and what the agency answered, so every decision has a record.
export type Message = { author: "owner" | "agency"; text: string; createdAt: string };

export function addMessage(
  storage: Storage,
  taskId: string,
  author: Message["author"],
  text: string,
  now = new Date(),
): void {
  refuseSecrets(text, "a chat message");
  storage.database
    .prepare("INSERT INTO task_messages (task_id, author, text, created_at) VALUES (?, ?, ?, ?)")
    .run(taskId, author, text, now.toISOString());
}

export function listMessages(storage: Storage, taskId: string): Message[] {
  const rows = storage.database
    .prepare("SELECT author, text, created_at FROM task_messages WHERE task_id = ? ORDER BY id")
    .all(taskId) as { author: Message["author"]; text: string; created_at: string }[];
  return rows.map(({ author, text, created_at }) => ({ author, text, createdAt: created_at }));
}
