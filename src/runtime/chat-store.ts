import { randomUUID } from "node:crypto";
import { refuseSecrets, type Storage } from "./storage.ts";

// Chat: plain conversations with a model, as in a chat app, kept apart from
// the code team's tasks. Every text passes refuseSecrets before it is stored
// (S6), and every reply keeps what it cost.

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  model: string | null;
  costUsd: number;
  createdAt: string;
};

export type Chat = {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

type ChatRow = { id: string; title: string; model: string; created_at: string; updated_at: string };

type MessageRow = {
  role: "user" | "assistant";
  text: string;
  model: string | null;
  cost_usd: number;
  created_at: string;
};

const toChat = (row: ChatRow): Chat => ({
  id: row.id,
  title: row.title,
  model: row.model,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// The first line of the first message, as a chat app titles a new chat.
function titleOf(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || "New chat";
}

export function createChat(
  storage: Storage,
  firstMessage: string,
  model: string,
  now = new Date(),
) {
  const title = titleOf(firstMessage);
  refuseSecrets(title, "a chat title");
  const chat: Chat = {
    id: randomUUID(),
    title,
    model,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  storage.database
    .prepare("INSERT INTO chats (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(chat.id, chat.title, chat.model, chat.createdAt, chat.updatedAt);
  return chat;
}

export type Reply = {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const noCost = { model: null, tokensIn: 0, tokensOut: 0, costUsd: 0 };

export function addChatMessage(
  storage: Storage,
  chatId: string,
  message: ({ role: "user" } & { text: string }) | ({ role: "assistant" } & Reply),
  now = new Date(),
): void {
  refuseSecrets(message.text, "a chat message");
  const { model, tokensIn, tokensOut, costUsd } = message.role === "assistant" ? message : noCost;
  const at = now.toISOString();
  storage.database
    .prepare(
      `INSERT INTO chat_messages (chat_id, role, text, model, tokens_in, tokens_out, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(chatId, message.role, message.text, model, tokensIn, tokensOut, costUsd, at);
  storage.database.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(at, chatId);
}

export function setChatModel(storage: Storage, chatId: string, model: string): void {
  storage.database.prepare("UPDATE chats SET model = ? WHERE id = ?").run(model, chatId);
}

// Most recently used first, as a chat app's sidebar lists them.
export function listChats(storage: Storage, limit = 50): Chat[] {
  const rows = storage.database
    .prepare("SELECT * FROM chats WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as ChatRow[];
  return rows.map(toChat);
}

export function getChat(storage: Storage, id: string): Chat | undefined {
  const row = storage.database
    .prepare("SELECT * FROM chats WHERE id = ? AND deleted_at IS NULL")
    .get(id) as ChatRow | undefined;
  return row ? toChat(row) : undefined;
}

export function chatMessages(storage: Storage, chatId: string): ChatMessage[] {
  const rows = storage.database
    .prepare(
      "SELECT role, text, model, cost_usd, created_at FROM chat_messages WHERE chat_id = ? ORDER BY id",
    )
    .all(chatId) as MessageRow[];
  return rows.map((row) => ({
    role: row.role,
    text: row.text,
    model: row.model,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  }));
}

// A chat app's Delete: the words are gone, but what each reply cost stays,
// so deleting a chat never lowers today's spend under the daily limit.
export function deleteChat(storage: Storage, id: string, now = new Date()): void {
  storage.database.prepare("UPDATE chat_messages SET text = '' WHERE chat_id = ?").run(id);
  storage.database
    .prepare("UPDATE chats SET title = '', deleted_at = ? WHERE id = ?")
    .run(now.toISOString(), id);
}
