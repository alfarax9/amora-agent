import { addChatMessage } from "./chat-store.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { isQuestion } from "./question.ts";
import type { Gap } from "./readiness.ts";
import { plannerId } from "./roster.ts";
import type { Storage } from "./storage.ts";
import { refuseGaps } from "./task-routes.ts";

// What a chat message asks for. A question is answered in the chat at once;
// anything else is work, which starts a task the Planner plans and the chat
// shows as cards. The composer can say which it is; Auto tells by the words.

export type Intent = "ask" | "task";

export type WorkDesk = {
  orchestrator: Orchestrator;
  // What must be set up before a task is accepted (readiness.ts).
  readiness(): Gap[];
  project(): string | undefined;
};

export function intentOf(wanted: unknown, text: string): Intent {
  if (wanted === "ask" || wanted === "task") return wanted;
  return isQuestion(text) ? "ask" : "task";
}

// The budget each task from chat starts with, set in Settings.
export function taskBudget(storage: Storage): number {
  return storage.getSetting<{ usd: number }>("taskBudget")?.usd ?? 1;
}

export const refuseUnreadyWork = (work: WorkDesk) => refuseGaps(work.readiness());

// Starts the task `messageId` asks for; a card after it stands for the task.
export function startTask(
  storage: Storage,
  work: WorkDesk,
  chatId: string,
  messageId: number,
  brief: string,
): void {
  const task = work.orchestrator.create(brief, taskBudget(storage), work.project(), chatId);
  addChatMessage(storage, chatId, {
    role: "assistant",
    text: "",
    parentId: messageId,
    worker: plannerId,
    kind: "card",
    taskId: task.id,
  });
}
