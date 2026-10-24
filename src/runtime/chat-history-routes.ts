import type { ChatDesk } from "./chat.ts";
import {
  emptyTrash,
  exportChat,
  listTrash,
  renameChat,
  restoreChat,
  starChat,
  trashChat,
} from "./chat-history.ts";
import { getChat, listChats } from "./chat-store.ts";
import { taskBudget } from "./intent.ts";
import { BadRequest, type JsonReply, refuseKeys } from "./task-routes.ts";

// The history side of chat's API: star, rename, export, the trash, and the
// owner's rules. chat-routes.ts hands over every chat path it does not answer.

type Params = Record<string, unknown>;

const listed = (desk: ChatDesk): JsonReply => ({
  status: 200,
  body: { chats: listChats(desk.storage), trash: listTrash(desk.storage) },
});

// The owner's rules: how replies should be written (a language, a tone, what
// to leave out), kept with their settings and given to every chat and worker.
const rulesOf = (desk: ChatDesk): JsonReply => ({
  status: 200,
  body: { text: desk.storage.getSetting<{ text: string }>("rules")?.text ?? "" },
});

// The budget each task started from chat gets (intent.ts).
const budgetOf = (desk: ChatDesk): JsonReply => ({
  status: 200,
  body: { usd: taskBudget(desk.storage) },
});

function saveBudget(desk: ChatDesk, params: Params): JsonReply {
  const usd = Number(params.usd);
  if (!(usd > 0) || usd > 10_000) throw new BadRequest(400, "Give a task budget above $0.");
  desk.storage.setSetting("taskBudget", { usd: Math.round(usd * 100) / 100 });
  return budgetOf(desk);
}

function saveRules(desk: ChatDesk, params: Params): JsonReply {
  const text = typeof params.text === "string" ? params.text.trim().slice(0, 4_000) : "";
  desk.storage.setSetting("rules", { text: refuseKeys(text) });
  return rulesOf(desk);
}

function exported(desk: ChatDesk, id: string, params: Params): JsonReply {
  const format = params.format === "json" ? "json" : "markdown";
  const content = exportChat(desk.storage, id, format);
  if (content === undefined) throw new BadRequest(404, "There is no such chat.");
  const title = getChat(desk.storage, id)?.title ?? "chat";
  const name = title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "chat";
  return {
    status: 200,
    body: { filename: `${name}.${format === "json" ? "json" : "md"}`, content },
  };
}

type Change = (desk: ChatDesk, id: string, params: Params) => void;

const changes: Record<string, Change> = {
  star: (desk, id, params) => starChat(desk.storage, id, params.starred !== false),
  rename: (desk, id, params) => {
    const title = typeof params.title === "string" ? params.title.trim() : "";
    if (!title) throw new BadRequest(400, "Give the chat a name.");
    renameChat(desk.storage, id, refuseKeys(title));
  },
  delete: (desk, id) => trashChat(desk.storage, id),
  restore: (desk, id) => restoreChat(desk.storage, id),
};

function post(desk: ChatDesk, path: string, params: Params): JsonReply | undefined {
  if (path === "/api/rules") return saveRules(desk, params);
  if (path === "/api/task-budget") return saveBudget(desk, params);
  if (path === "/api/chats/trash/empty") return (emptyTrash(desk.storage), listed(desk));
  const [, id = "", name = ""] = /^\/api\/chats\/([0-9a-f-]{36})\/([a-z]+)$/.exec(path) ?? [];
  const change = changes[name];
  if (!change) return undefined;
  const known = getChat(desk.storage, id) ?? listTrash(desk.storage).find((chat) => chat.id === id);
  if (!known) throw new BadRequest(404, "There is no such chat.");
  change(desk, id, params);
  return listed(desk);
}

function get(desk: ChatDesk, path: string, params: Params): JsonReply | undefined {
  if (path === "/api/rules") return rulesOf(desk);
  if (path === "/api/task-budget") return budgetOf(desk);
  if (path === "/api/chats/trash") return listed(desk);
  const [, id = ""] = /^\/api\/chats\/([0-9a-f-]{36})\/export$/.exec(path) ?? [];
  return id ? exported(desk, id, params) : undefined;
}

export function answerHistory(
  desk: ChatDesk,
  method: string,
  path: string,
  params: Params,
): JsonReply | undefined {
  return method === "GET" ? get(desk, path, params) : post(desk, path, params);
}
