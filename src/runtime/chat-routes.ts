import type { IncomingMessage } from "node:http";
import { type ChatDesk, listen, liveReply, startReply } from "./chat.ts";
import {
  addChatMessage,
  chatMessages,
  createChat,
  deleteChat,
  getChat,
  listChats,
  setChatModel,
} from "./chat-store.ts";
import { spentSince } from "./task-store.ts";
import { BadRequest, type JsonReply, readJson, refuseKeys } from "./task-routes.ts";

// Chat's API, apart from the code team's tasks: list chats, start one, send a
// message, follow the reply as server-sent events, and change a chat's model
// or delete it. Behind the session and Origin checks like every API route.

// Server-sent events, for a reply that streams: the server writes each event
// and calls `end` when the stream is over or the page leaves.
export type EventStream = {
  stream: (write: (event: string, data: unknown) => void, end: () => void) => () => void;
};

const messageOf = (body: Record<string, unknown>) => {
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (!text) throw new BadRequest(400, "Write a message first.");
  if (text.length > 100_000) throw new BadRequest(413, "That message is too long.");
  return refuseKeys(text);
};

// Chat costs money like a task, so it stops at the daily limit; with no
// limit set, the OpenRouter key's own credit limit is the ceiling.
function refuseOverLimit(desk: ChatDesk): void {
  const daily = desk.storage.getSetting<{ dailyUsd: number }>("budgets")?.dailyUsd;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (daily !== undefined && spentSince(desk.storage, today) >= daily) {
    throw new BadRequest(
      409,
      "Today's spending limit is reached. Raise it with amora budget --daily <usd>.",
    );
  }
}

function modelOf(desk: ChatDesk, wanted: unknown): string {
  const model = typeof wanted === "string" && wanted ? wanted : desk.defaultModel();
  if (!model)
    throw new BadRequest(409, "No model is set yet. Run: amora models set global <model>");
  if (typeof wanted === "string" && wanted && !desk.models().includes(wanted)) {
    throw new BadRequest(400, `${wanted} is not one of your models. Add it with amora models set.`);
  }
  return model;
}

function overview(desk: ChatDesk): JsonReply {
  const chats = listChats(desk.storage);
  return {
    status: 200,
    body: { chats, models: desk.models(), model: desk.defaultModel() ?? null },
  };
}

function thread(desk: ChatDesk, id: string): JsonReply {
  const chat = getChat(desk.storage, id);
  if (!chat) throw new BadRequest(404, "There is no such chat.");
  const messages = chatMessages(desk.storage, id);
  return { status: 200, body: { chat, messages, pending: liveReply(id) ?? null } };
}

// One reply at a time, as in a chat app: the next message waits for it.
function refuseBusy(id: string): void {
  const now = liveReply(id);
  if (now && !now.error) throw new BadRequest(409, "Wait for the reply to finish first.");
}

function send(desk: ChatDesk, id: string, text: string): JsonReply {
  refuseBusy(id);
  refuseOverLimit(desk);
  addChatMessage(desk.storage, id, { role: "user", text });
  startReply(desk, id);
  return { ...thread(desk, id), status: 202 };
}

type Action = (desk: ChatDesk, id: string, body: Record<string, unknown>) => JsonReply;

const actions: Record<string, Action> = {
  messages: (desk, id, body) => send(desk, id, messageOf(body)),
  retry: (desk, id) => (
    refuseBusy(id),
    refuseOverLimit(desk),
    startReply(desk, id),
    { ...thread(desk, id), status: 202 }
  ),
  model: (desk, id, body) => (
    setChatModel(desk.storage, id, modelOf(desk, body.model)),
    thread(desk, id)
  ),
  delete: (desk, id) => (deleteChat(desk.storage, id), overview(desk)),
};

async function post(desk: ChatDesk, request: IncomingMessage, path: string) {
  const body = await readJson(request);
  if (path === "/api/chats") {
    const text = messageOf(body);
    const chat = createChat(desk.storage, text, modelOf(desk, body.model));
    return { ...send(desk, chat.id, text), status: 201 };
  }
  if (path === "/api/rules") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 4_000) : "";
    desk.storage.setSetting("rules", { text: refuseKeys(text) });
    return rulesOf(desk);
  }
  if (path === "/api/chat/model") {
    desk.storage.setSetting("chat", { model: modelOf(desk, body.model) });
    return overview(desk);
  }
  const [, id = "", name = ""] = /^\/api\/chats\/([0-9a-f-]{36})\/([a-z]+)$/.exec(path) ?? [];
  if (!getChat(desk.storage, id) || !actions[name]) return undefined;
  return actions[name](desk, id, body);
}

// The reply as it is written: what is there already, then each new piece.
function events(id: string): EventStream {
  return {
    stream: (write, end) => {
      const now = liveReply(id);
      write("snapshot", { text: now?.text ?? "", ...(now?.error ? { error: now.error } : {}) });
      if (!now || now.error) return (end(), () => undefined);
      return listen(id, (event) => {
        write(event.type, event);
        if (event.type === "done" || event.type === "failed") end();
      });
    },
  };
}

// The owner's rules: how replies should be written (a language, a tone, what
// to leave out), kept with their settings and given to every chat.
const rulesOf = (desk: ChatDesk): JsonReply => ({
  status: 200,
  body: { text: desk.storage.getSetting<{ text: string }>("rules")?.text ?? "" },
});

function get(desk: ChatDesk, path: string): JsonReply | EventStream | undefined {
  if (path === "/api/chats") return overview(desk);
  if (path === "/api/rules") return rulesOf(desk);
  const [, id = "", rest] = /^\/api\/chats\/([0-9a-f-]{36})(\/events)?$/.exec(path) ?? [];
  if (!id) return undefined;
  return rest ? events(id) : thread(desk, id);
}

// Answers a chat request, or nothing when the path is not one of these.
export async function handleChatApi(
  desk: ChatDesk,
  request: IncomingMessage,
  path: string,
): Promise<JsonReply | EventStream | undefined> {
  try {
    if (request.method === "GET") return get(desk, path);
    return request.method === "POST" ? await post(desk, request, path) : undefined;
  } catch (error) {
    if (error instanceof BadRequest)
      return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
