import { type Chat, chatMessages, getChat, titleOf } from "./chat-store.ts";
import { branch } from "./chat-tree.ts";
import { retitle, unindex } from "./search.ts";
import { refuseSecrets, type Storage } from "./storage.ts";

// A chat's history, as a chat app keeps it: star, rename, export, and delete.
// Delete moves a chat to the trash, where it can be restored; emptying the
// trash blanks its words for good but keeps what each reply cost, so it never
// lowers today's spend under the daily limit.

export function starChat(storage: Storage, id: string, starred: boolean): void {
  storage.database.prepare("UPDATE chats SET starred = ? WHERE id = ?").run(starred ? 1 : 0, id);
}

export function renameChat(storage: Storage, id: string, title: string): void {
  const name = titleOf(title);
  refuseSecrets(name, "a chat title");
  storage.database.prepare("UPDATE chats SET title = ? WHERE id = ?").run(name, id);
  retitle(storage, "chat", id, name);
}

export function trashChat(storage: Storage, id: string, now = new Date()): void {
  storage.database
    .prepare("UPDATE chats SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(now.toISOString(), id);
}

export function restoreChat(storage: Storage, id: string): void {
  storage.database
    .prepare("UPDATE chats SET deleted_at = NULL WHERE id = ? AND purged_at IS NULL")
    .run(id);
}

type TrashRow = { id: string; title: string; deleted_at: string };

export function listTrash(storage: Storage): { id: string; title: string; deletedAt: string }[] {
  const rows = storage.database
    .prepare(
      `SELECT id, title, deleted_at FROM chats
       WHERE deleted_at IS NOT NULL AND purged_at IS NULL ORDER BY deleted_at DESC`,
    )
    .all() as TrashRow[];
  return rows.map(({ id, title, deleted_at }) => ({ id, title, deletedAt: deleted_at }));
}

export function emptyTrash(storage: Storage, now = new Date()): void {
  for (const { id } of listTrash(storage)) {
    storage.database.prepare("UPDATE chat_messages SET text = '' WHERE chat_id = ?").run(id);
    storage.database
      .prepare("UPDATE chats SET title = '', purged_at = ? WHERE id = ?")
      .run(now.toISOString(), id);
    unindex(storage, "chat", id);
  }
}

function markdownOf(chat: Chat, storage: Storage): string {
  const said = branch(storage, chat.id)
    .filter(({ kind }) => kind === "text")
    .map(({ role, worker, text }) => {
      const who = role === "user" ? "You" : (worker ?? "AMORA");
      return `**${who}**\n\n${text}`;
    });
  return [`# ${chat.title}`, ...said].join("\n\n") + "\n";
}

// The branch shown, as Markdown, or every message and branch as JSON.
export function exportChat(
  storage: Storage,
  id: string,
  format: "markdown" | "json",
): string | undefined {
  const chat = getChat(storage, id);
  if (!chat) return undefined;
  if (format === "markdown") return markdownOf(chat, storage);
  return JSON.stringify({ chat, messages: chatMessages(storage, id) }, null, 2);
}
