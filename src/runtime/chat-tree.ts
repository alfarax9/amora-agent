import { type ChatMessage, chatMessages, getChat } from "./chat-store.ts";
import type { Storage } from "./storage.ts";

// A chat's messages form a tree. An edited message and a retried reply are
// siblings of the one they replace; the chat shows one branch, from the root
// to its leaf, and each message on it knows which of its versions it is.

export type ShownMessage = ChatMessage & {
  // 1-based position among the siblings with the same parent and role.
  version: number;
  versions: number[];
};

function siblingsOf(all: ChatMessage[], message: ChatMessage): number[] {
  return all
    .filter(({ parentId, role }) => parentId === message.parentId && role === message.role)
    .map(({ id }) => id);
}

// The branch that ends at the chat's leaf, root first.
export function branch(storage: Storage, chatId: string): ShownMessage[] {
  const all = chatMessages(storage, chatId);
  const byId = new Map(all.map((message) => [message.id, message]));
  const path: ChatMessage[] = [];
  for (let id = getChat(storage, chatId)?.leafId ?? null; id !== null;) {
    const message = byId.get(id);
    if (!message) break;
    path.unshift(message);
    id = message.parentId;
  }
  return path.map((message) => {
    const versions = siblingsOf(all, message);
    return { ...message, version: versions.indexOf(message.id) + 1, versions };
  });
}

// Shows the branch through `messageId`: from it, the newest child each time.
export function showBranch(storage: Storage, chatId: string, messageId: number): boolean {
  const all = chatMessages(storage, chatId);
  if (!all.some(({ id }) => id === messageId)) return false;
  let leaf = messageId;
  for (;;) {
    const children = all.filter(({ parentId }) => parentId === leaf);
    const newest = children.at(-1);
    if (!newest) break;
    leaf = newest.id;
  }
  storage.database.prepare("UPDATE chats SET leaf_id = ? WHERE id = ?").run(leaf, chatId);
  return true;
}
