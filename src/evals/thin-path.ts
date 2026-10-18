import type { Agency } from "../runtime/agency.ts";
import type { Logger } from "../runtime/logger.ts";
import { createOrchestrator, type Orchestrator, Refusal } from "../runtime/orchestrator.ts";
import { getTask, type Task } from "../runtime/task-store.ts";
import type { SystemRun } from "./single-agent.ts";

// AMORA's side of the benchmark: the brief goes through the thin path as an
// owner would run it, with the plan approved as drafted, no retries after a
// stop, and Complete once every step passed its gate.

const stopped = (task: Task | undefined, fallback: string): SystemRun => ({
  delivered: false,
  reason: task?.reason ?? fallback,
});

async function approve(orchestrator: Orchestrator, id: string): Promise<string | undefined> {
  try {
    await orchestrator.approve(id);
    return undefined;
  } catch (error) {
    if (error instanceof Refusal) return error.message;
    throw error;
  }
}

export async function runThinPath(
  agency: Agency,
  brief: string,
  project: string,
  budgetUsd: number,
  logger: Logger,
): Promise<SystemRun> {
  const orchestrator = createOrchestrator(agency, { logger });
  const { id } = orchestrator.create(brief, budgetUsd, project);
  await orchestrator.settled(id);
  const planned = getTask(agency.storage, id);
  if (planned?.status !== "awaiting_plan_approval") return stopped(planned, "No plan was drafted.");
  const refusal = await approve(orchestrator, id);
  if (refusal) return { delivered: false, reason: refusal };
  await orchestrator.settled(id);
  const task = getTask(agency.storage, id);
  const steps = task?.plan?.steps.length ?? Infinity;
  if (task?.status !== "awaiting_decision" || task.step < steps) {
    return stopped(task, "The task did not finish.");
  }
  orchestrator.decide(id, { action: "complete" });
  return { delivered: true, reason: "Every step passed its gate." };
}
