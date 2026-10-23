import { perform } from "./agency.ts";
import { type Desk, describe, load, move, save, say, stopAfterError } from "./dispatch.ts";
import { isQuestion } from "./question.ts";
import { assertMove } from "./task-states.ts";
import type { Task } from "./task-store.ts";

// A question gets its answer in one call to the Assistant, as a chat model
// would give it: no plan to approve, no copy of the project, and the task
// ends with the answer. Anything else is planned as before.

export const assistantId = "assistant";

async function answer(desk: Desk, id: string): Promise<Task> {
  const task = load(desk, id);
  try {
    const outcome = await perform(desk.agency, {
      task,
      worker: assistantId,
      input: { question: task.brief },
      receiver: "owner",
      attempt: 1,
    });
    const latest = load(desk, id);
    const spent = { ...latest, spentUsd: latest.spentUsd + outcome.costUsd };
    if (latest.status !== "planning") return save(desk, spent);
    if (outcome.result !== "passed") {
      return move(
        desk,
        spent,
        "awaiting_decision",
        `The answer is not ready. ${describe(outcome)}`,
      );
    }
    say(desk, id, "agency", (outcome.output as { answer: string }).answer);
    // The answer is the reply; a "task is complete" line after it is noise.
    assertMove(spent.status, "completed");
    return save(desk, { ...spent, status: "completed" });
  } catch (error) {
    return stopAfterError(desk, id, "planning", error);
  }
}

// Where a task without a plan starts. A question is created without a
// project (orchestrator.ts), so its answer never copies one.
export function firstStep(
  desk: Desk,
  id: string,
  plan: (desk: Desk, id: string) => Promise<Task>,
): Promise<Task> {
  const task = load(desk, id);
  return !task.project && isQuestion(task.brief) ? answer(desk, id) : plan(desk, id);
}
