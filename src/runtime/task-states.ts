// The task lifecycle (dashboard PRD, Tasks), plus Planning while the Planner /
// Decomposer drafts the plan. The orchestrator is code, not a model (PRD §5),
// so every move a task can make is listed here and any other move is a bug.

export type TaskStatus =
  | "planning"
  | "awaiting_plan_approval"
  | "running"
  | "awaiting_decision"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

const moves: Record<TaskStatus, TaskStatus[]> = {
  planning: ["awaiting_plan_approval", "awaiting_decision", "failed", "cancelled"],
  awaiting_plan_approval: ["running", "planning", "cancelled"],
  running: ["running", "awaiting_decision", "paused", "completed", "failed", "cancelled"],
  awaiting_decision: ["running", "planning", "completed", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canMove(from: TaskStatus, to: TaskStatus): boolean {
  return moves[from].includes(to);
}

export function assertMove(from: TaskStatus, to: TaskStatus): void {
  if (!canMove(from, to)) throw new Error(`A task cannot go from ${from} to ${to}.`);
}

export function isFinished(status: TaskStatus): boolean {
  return moves[status].length === 0;
}
