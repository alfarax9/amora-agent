import { randomUUID } from "node:crypto";
import { indexText } from "./search.ts";
import { refuseSecrets, type Storage } from "./storage.ts";

// Chat: conversations with the agency, kept apart from the tasks they start.
// Messages form a tree (chat-tree.ts): an edit or a retry adds a sibling, and
// the chat shows the branch that ends at its leaf. Every text passes
// refuseSecrets before it is stored (S6), and every reply keeps what it cost.

type MessageStatus = "done" | "stopped" | "failed";

export type ChatMessage = {
  id: number;
  parentId: number | null;
  role: "user" | "assistant";
  text: string;
  model: string | null;
  // The worker that answered; replies from before the agency answered chat have none.
  worker: string | null;
  status: MessageStatus;
  // A card stands for a task the message started.
  kind: "text" | "card";
  taskId: string | null;
  costUsd: number;
  createdAt: string;
};

export type Chat = {
  id: string;
  title: string;
  model: string;
  starred: boolean;
  leafId: number | null;
  createdAt: string;
  updatedAt: string;
};

type ChatRow = {
  id: string;
  title: string;
  model: string;
  starred: number;
  leaf_id: number | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: number;
  parent_id: number | null;
  role: "user" | "assistant";
  text: string;
  model: string | null;
  worker: string | null;
  status: MessageStatus;
  kind: "text" | "card";
  task_id: string | null;
  cost_usd: number;
  created_at: string;
};

const toChat = (row: ChatRow): Chat => ({
  id: row.id,
  title: row.title,
  model: row.model,
  starred: row.starred === 1,
  leafId: row.leaf_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  parentId: row.parent_id,
  role: row.role,
  text: row.text,
  model: row.model,
  worker: row.worker,
  status: row.status,
  kind: row.kind,
  taskId: row.task_id,
  costUsd: row.cost_usd,
  createdAt: row.created_at,
});

// The first line of the first message, as a chat app titles a new chat.
export function titleOf(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || "New chat";
}

export function createChat(
  storage: Storage,
  firstMessage: string,
  model: string,
  now = new Date(),
): Chat {
  const title = titleOf(firstMessage);
  refuseSecrets(title, "a chat title");
  const at = now.toISOString();
  const chat: Chat = {
    id: randomUUID(),
    title,
    model,
    starred: false,
    leafId: null,
    createdAt: at,
    updatedAt: at,
  };
  storage.database
    .prepare("INSERT INTO chats (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(chat.id, chat.title, chat.model, at, at);
  indexText(storage, "chat", chat.id, { title });
  return chat;
}

export type NewMessage = {
  role: "user" | "assistant";
  text: string;
  // The message this one follows; without it, the chat's leaf.
  parentId?: number | null;
  model?: string;
  worker?: string;
  status?: MessageStatus;
  kind?: "text" | "card";
  taskId?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
};

const unsaid = {
  model: null,
  worker: null,
  status: "done",
  kind: "text",
  taskId: null,
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
} as const;

// Adds the message and makes it the chat's leaf; returns its id.
export function addChatMessage(
  storage: Storage,
  chatId: string,
  message: NewMessage,
  now = new Date(),
): number {
  refuseSecrets(message.text, "a chat message");
  const at = now.toISOString();
  const said = { ...unsaid, ...message };
  const parent = said.parentId === undefined ? getChat(storage, chatId)?.leafId : said.parentId;
  const { lastInsertRowid } = storage.database
    .prepare(
      `INSERT INTO chat_messages (chat_id, parent_id, role, text, model, worker, status, kind,
       task_id, tokens_in, tokens_out, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      chatId,
      parent ?? null,
      said.role,
      said.text,
      said.model,
      said.worker,
      said.status,
      said.kind,
      said.taskId,
      said.tokensIn,
      said.tokensOut,
      said.costUsd,
      at,
    );
  const id = Number(lastInsertRowid);
  storage.database
    .prepare("UPDATE chats SET leaf_id = ?, updated_at = ? WHERE id = ?")
    .run(id, at, chatId);
  if (said.text) indexText(storage, "chat", chatId, { body: said.text });
  return id;
}

// Most recently used first, as a chat app's sidebar lists them.
export function listChats(storage: Storage, limit = 100): Chat[] {
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

// Every message of the chat, every branch, oldest first.
export function chatMessages(storage: Storage, chatId: string): ChatMessage[] {
  const rows = storage.database
    .prepare(
      `SELECT id, parent_id, role, text, model, worker, status, kind, task_id, cost_usd, created_at
       FROM chat_messages WHERE chat_id = ? ORDER BY id`,
    )
    .all(chatId) as MessageRow[];
  return rows.map(toMessage);
}
