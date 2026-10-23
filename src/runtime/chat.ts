import {
  type Chat as ChatCall,
  type ChatRequest,
  type ChatResponse,
  withRetries,
} from "../model-layer/gateway.ts";
import { addChatMessage, chatMessages, getChat } from "./chat-store.ts";
import type { Logger } from "./logger.ts";
import { redactSecrets } from "./secret-scanner.ts";
import type { Storage } from "./storage.ts";

// A chat's replies, written the way a chat app writes them: the conversation
// so far goes to the chat's model, the reply streams to
// the page piece by piece (chat-routes.ts serves it as server-sent events),
// and the finished reply is stored with its model, tokens, and cost.

export type ChatDesk = {
  storage: Storage;
  connect(model: string): Promise<{ chat: ChatCall; name: string }>;
  // The model a new chat uses: the owner's choice, or the global model.
  defaultModel(): string | undefined;
  // The models the owner has assigned, to choose from.
  models(): string[];
  prompt: string;
  logger: Logger;
  retryDelaysMs?: number[];
};

export type LiveEvent =
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "done" }
  | { type: "failed"; error: string };

// A reply being written now: the text so far, and the pages listening.
type Live = { text: string; error?: string; listeners: Set<(event: LiveEvent) => void> };

const live = new Map<string, Live>();

export function liveReply(chatId: string): { text: string; error?: string } | undefined {
  const reply = live.get(chatId);
  return reply && { text: reply.text, ...(reply.error ? { error: reply.error } : {}) };
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

function conversation(desk: ChatDesk, chatId: string): ChatRequest["messages"] {
  const kept: ChatRequest["messages"] = [];
  let used = 0;
  for (const { role, text } of chatMessages(desk.storage, chatId).reverse()) {
    if (!text || used + text.length > historyChars) break;
    used += text.length;
    kept.unshift({ role, content: text });
  }
  return [{ role: "system", content: desk.prompt.trim() }, ...kept];
}

function store(desk: ChatDesk, chatId: string, model: string, reply: ChatResponse, text: string) {
  addChatMessage(desk.storage, chatId, {
    role: "assistant",
    text,
    model: reply.model ?? model,
    tokensIn: reply.usage?.prompt_tokens ?? 0,
    tokensOut: reply.usage?.completion_tokens ?? 0,
    costUsd: reply.usage?.cost ?? 0,
  });
}

async function write(desk: ChatDesk, chatId: string, reply: Live): Promise<void> {
  const chat = getChat(desk.storage, chatId);
  if (!chat) throw new Error("This chat is gone.");
  const connected = await desk.connect(chat.model);
  // A retried call starts its reply again, so the page starts over too.
  const onRetry = () => ((reply.text = ""), emit(reply, { type: "reset" }));
  const delays = desk.retryDelaysMs ? { retryDelaysMs: desk.retryDelaysMs } : {};
  const call = withRetries(connected.chat, { ...delays, onRetry });
  const onText = (text: string) => ((reply.text += text), emit(reply, { type: "text", text }));
  const request = {
    model: connected.name,
    max_tokens: 16_000,
    messages: conversation(desk, chatId),
  };
  const answer = await call(request, { onText });
  const text = answer.choices[0]?.message.content ?? reply.text;
  if (!text.trim()) throw new Error("The model sent an empty reply.");
  store(desk, chatId, chat.model, answer, text);
}

// Writes the reply to a chat's last message in the background. A failure
// stays with the chat until the next reply, so the page can say what went
// wrong and offer to try again.
export function startReply(desk: ChatDesk, chatId: string): void {
  const reply: Live = { text: "", listeners: live.get(chatId)?.listeners ?? new Set() };
  live.set(chatId, reply);
  void write(desk, chatId, reply)
    .then(() => {
      live.delete(chatId);
      emit(reply, { type: "done" });
    })
    .catch((error: unknown) => {
      reply.error = redactSecrets(error instanceof Error ? error.message : String(error));
      desk.logger.warn("A chat reply failed", { chat: chatId, reason: reply.error });
      emit(reply, { type: "failed", error: reply.error });
    });
}
