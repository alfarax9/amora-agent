import {
  type Chat as ChatCall,
  type ChatRequest,
  type ChatResponse,
  withRetries,
} from "../model-layer/gateway.ts";
import type { Brain } from "./brain.ts";
import { addChatMessage, getChat, type NewMessage } from "./chat-store.ts";
import { branch } from "./chat-tree.ts";
import type { WorkDesk } from "./intent.ts";
import type { Logger } from "./logger.ts";
import { redactSecrets } from "./secret-scanner.ts";
import type { Storage } from "./storage.ts";

// A chat's replies, written by the agency's Assistant the way a chat app
// writes them: the branch so far goes to the Assistant's brain with the
// owner's rules, the reply streams to the page piece by piece (chat-routes.ts
// serves it as server-sent events), and the finished reply is stored with the
// worker, model, tokens, and cost. Stop keeps what was written so far.

export type ChatDesk = {
  storage: Storage;
  // The worker that answers in chat, with its brain, or why none can.
  brain(): Brain | { problem: string };
  connect(model: string): Promise<{ chat: ChatCall; name: string }>;
  prompt: string;
  logger: Logger;
  retryDelaysMs?: number[];
  // Starts tasks from chat (intent.ts); without it, chat only answers.
  work?: WorkDesk;
};

export type LiveEvent =
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "done" }
  | { type: "failed"; error: string };

// A reply being written now: the message it answers, the text so far, and
// the pages listening.
type Live = {
  parentId: number;
  text: string;
  error?: string;
  listeners: Set<(event: LiveEvent) => void>;
  controller: AbortController;
};

const live = new Map<string, Live>();

export function liveReply(
  chatId: string,
): { parentId: number; text: string; error?: string } | undefined {
  const reply = live.get(chatId);
  if (!reply) return undefined;
  const { parentId, text, error } = reply;
  return { parentId, text, ...(error ? { error } : {}) };
}

export function listen(chatId: string, listener: (event: LiveEvent) => void): () => void {
  const reply = live.get(chatId);
  if (!reply) return () => undefined;
  reply.listeners.add(listener);
  return () => reply.listeners.delete(listener);
}

function emit(reply: Live, event: LiveEvent): void {
  for (const listener of reply.listeners) listener(event);
}

// The newest messages that fit, so a long chat keeps its recent context.
const historyChars = 60_000;

// The branch up to the message being answered: a retried reply answers the
// same message again, without the replies it replaces.
function conversation(desk: ChatDesk, chatId: string, parentId: number) {
  const path = branch(desk.storage, chatId);
  const upTo = path.slice(0, path.findIndex(({ id }) => id === parentId) + 1);
  const kept: ChatRequest["messages"] = [];
  let used = 0;
  for (const { role, text, kind, status } of upTo.reverse()) {
    if (kind !== "text" || status === "failed" || !text) continue;
    if (used + text.length > historyChars) break;
    used += text.length;
    kept.unshift({ role, content: text });
  }
  const rules = desk.storage.getSetting<{ text: string }>("rules")?.text?.trim();
  const system = rules
    ? `${desk.prompt.trim()}\n\nThe owner's rules, which always apply:\n${rules}`
    : desk.prompt.trim();
  return [{ role: "system" as const, content: system }, ...kept];
}

// What the gateway reported for a finished reply; a stopped one reports nothing.
function usageOf(answer: ChatResponse, brain: Brain) {
  const usage = answer.usage ?? {};
  return {
    model: answer.model ?? brain.model,
    tokensIn: usage.prompt_tokens ?? 0,
    tokensOut: usage.completion_tokens ?? 0,
    costUsd: usage.cost ?? 0,
  };
}

function store(
  desk: ChatDesk,
  chatId: string,
  brain: Brain,
  reply: Live,
  said: Partial<NewMessage>,
) {
  addChatMessage(desk.storage, chatId, {
    role: "assistant",
    text: reply.text,
    parentId: reply.parentId,
    worker: brain.worker,
    model: brain.model,
    ...said,
  });
}

async function write(desk: ChatDesk, chatId: string, brain: Brain, reply: Live): Promise<void> {
  if (!getChat(desk.storage, chatId)) throw new Error("This chat is gone.");
  const connected = await desk.connect(brain.model);
  // A retried call starts its reply again, so the page starts over too.
  const onRetry = () => ((reply.text = ""), emit(reply, { type: "reset" }));
  const delays = desk.retryDelaysMs ? { retryDelaysMs: desk.retryDelaysMs } : {};
  const call = withRetries(connected.chat, { ...delays, onRetry });
  const onText = (text: string) => ((reply.text += text), emit(reply, { type: "text", text }));
  const request = {
    model: connected.name,
    max_tokens: 16_000,
    messages: conversation(desk, chatId, reply.parentId),
  };
  const answer = await call(request, { onText, signal: reply.controller.signal });
  const text = answer.choices[0]?.message.content ?? reply.text;
  if (!text.trim()) throw new Error("The model sent an empty reply.");
  store(desk, chatId, brain, reply, { text, ...usageOf(answer, brain) });
}

function finish(chatId: string, reply: Live): void {
  live.delete(chatId);
  emit(reply, { type: "done" });
}

// Writes the reply to `parentId` in the background. A failure stays with the
// chat until the next reply, so the page can say what went wrong and offer to
// try again; a stopped reply keeps the text written so far.
export function startReply(desk: ChatDesk, chatId: string, brain: Brain, parentId: number): void {
  const listeners = live.get(chatId)?.listeners ?? new Set();
  const reply: Live = { parentId, text: "", listeners, controller: new AbortController() };
  live.set(chatId, reply);
  void write(desk, chatId, brain, reply)
    .then(() => finish(chatId, reply))
    .catch((error: unknown) => {
      if (reply.controller.signal.aborted) {
        if (reply.text.trim()) store(desk, chatId, brain, reply, { status: "stopped" });
        return finish(chatId, reply);
      }
      reply.error = redactSecrets(error instanceof Error ? error.message : String(error));
      desk.logger.warn("A chat reply failed", { chat: chatId, reason: reply.error });
      emit(reply, { type: "failed", error: reply.error });
    });
}

// Stops the reply being written; false when there is none.
export function stopReply(chatId: string): boolean {
  const reply = live.get(chatId);
  if (!reply || reply.error) return false;
  reply.controller.abort();
  return true;
}
