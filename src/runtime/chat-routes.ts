import type { IncomingMessage } from "node:http";
import type { Brain } from "./brain.ts";
import { type ChatDesk, listen, liveReply, startReply, stopReply } from "./chat.ts";
import { listTrash } from "./chat-history.ts";
import { answerHistory } from "./chat-history-routes.ts";
import { addChatMessage, chatMessages, createChat, getChat, listChats } from "./chat-store.ts";
import { branch, showBranch } from "./chat-tree.ts";
import { intentOf, refuseUnreadyWork, startTask } from "./intent.ts";
import { spentSince } from "./task-store.ts";
import { BadRequest, type JsonReply, readJson, refuseKeys } from "./task-routes.ts";

// Chat's API: list chats, start one, send a message, follow the reply as
// server-sent events, stop it, retry it, edit a message into a new branch,
// and move between branches. History (star, rename, trash, export) and the
// owner's rules are in chat-history-routes.ts. Behind the session and Origin
// checks like every API route.

// Server-sent events, for a reply that streams: the server writes each event
// and calls `end` when the stream is over or the page leaves.
export type EventStream = {
  stream: (write: (event: string, data: unknown) => void, end: () => void) => () => void;
};

// What the owner wrote, and whether they said it is a question or work.
type Said = { text: string; intent: unknown };

const messageOf = (body: Record<string, unknown>): Said => {
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (!text) throw new BadRequest(400, "Write a message first.");
  if (text.length > 100_000) throw new BadRequest(413, "That message is too long.");
  return { text: refuseKeys(text), intent: body.intent };
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

// One reply at a time, as in a chat app: the next message waits for it.
function refuseBusy(id: string): void {
  const now = liveReply(id);
  if (now && !now.error) throw new BadRequest(409, "Wait for the reply to finish first.");
}

function brainOf(desk: ChatDesk): Brain {
  const brain = desk.brain();
  if ("problem" in brain) {
    throw new BadRequest(409, `${brain.problem} Run: amora models set global <model>`);
  }
  return brain;
}

function overview(desk: ChatDesk): JsonReply {
  const brain = desk.brain();
  const trash = listTrash(desk.storage);
  return { status: 200, body: { chats: listChats(desk.storage), trash, brain } };
}

function thread(desk: ChatDesk, id: string): JsonReply {
  const chat = getChat(desk.storage, id);
  if (!chat) throw new BadRequest(404, "There is no such chat.");
  const messages = branch(desk.storage, id);
  return { status: 200, body: { chat, messages, pending: liveReply(id) ?? null } };
}

// Stores the owner's message after `parentId` (the leaf when undefined) and
// answers it, or starts the task it asks for.
function send(desk: ChatDesk, id: string, said: Said, parentId?: number | null): JsonReply {
  refuseBusy(id);
  refuseOverLimit(desk);
  const work = desk.work && intentOf(said.intent, said.text) === "task" ? desk.work : undefined;
  if (work) refuseUnreadyWork(work);
  const brain = work ? undefined : brainOf(desk);
  const message = addChatMessage(desk.storage, id, {
    role: "user",
    text: said.text,
    ...(parentId === undefined ? {} : { parentId }),
  });
  if (work) startTask(desk.storage, work, id, message, said.text);
  if (brain) startReply(desk, id, brain, message);
  return { ...thread(desk, id), status: 202 };
}

function messageIn(desk: ChatDesk, id: string, wanted: unknown) {
  const message = chatMessages(desk.storage, id).find(({ id: own }) => own === wanted);
  if (!message) throw new BadRequest(404, "There is no such message in this chat.");
  return message;
}

// A message that started a task is changed with Request change, never edited
// or retried: that would start the work twice.
function refuseTaskMessage(desk: ChatDesk, id: string, messageId: number): void {
  const started = chatMessages(desk.storage, id).some(
    ({ id: own, parentId, kind }) =>
      kind === "card" && (own === messageId || parentId === messageId),
  );
  if (started) {
    throw new BadRequest(409, "This message started a task. Ask for a change in its plan instead.");
  }
}

// A new version of a reply: to the message a reply answers, or after a
// failure, to the message the failed reply was answering.
function retry(desk: ChatDesk, id: string, body: Record<string, unknown>): JsonReply {
  refuseBusy(id);
  refuseOverLimit(desk);
  const failed = liveReply(id)?.parentId;
  const parentId =
    body.messageId === undefined ? failed : messageIn(desk, id, body.messageId).parentId;
  if (parentId === undefined || parentId === null) {
    throw new BadRequest(400, "Name the reply to try again.");
  }
  refuseTaskMessage(desk, id, parentId);
  startReply(desk, id, brainOf(desk), parentId);
  return { ...thread(desk, id), status: 202 };
}

// An edited message is a sibling of the original, so the original and its
// replies stay one version back.
function edit(desk: ChatDesk, id: string, body: Record<string, unknown>): JsonReply {
  const original = messageIn(desk, id, body.messageId);
  if (original.role !== "user") throw new BadRequest(400, "Only your own messages can be edited.");
  refuseTaskMessage(desk, id, original.id);
  return send(desk, id, messageOf(body), original.parentId);
}

type Action = (desk: ChatDesk, id: string, body: Record<string, unknown>) => JsonReply;

const actions: Record<string, Action> = {
  messages: (desk, id, body) => send(desk, id, messageOf(body)),
  retry,
  edit,
  stop: (desk, id) => (stopReply(id), thread(desk, id)),
  branch: (desk, id, body) => {
    if (typeof body.messageId !== "number" || !showBranch(desk.storage, id, body.messageId)) {
      throw new BadRequest(404, "There is no such message in this chat.");
    }
    return thread(desk, id);
  },
};

async function post(desk: ChatDesk, request: IncomingMessage, path: string) {
  const body = await readJson(request);
  if (path === "/api/chats") {
    const said = messageOf(body);
    refuseOverLimit(desk);
    const brain = desk.brain();
    const chat = createChat(desk.storage, said.text, "model" in brain ? brain.model : "");
    return { ...send(desk, chat.id, said), status: 201 };
  }
  const [, id = "", name = ""] = /^\/api\/chats\/([0-9a-f-]{36})\/([a-z]+)$/.exec(path) ?? [];
  if (!getChat(desk.storage, id) || !actions[name]) return answerHistory(desk, "POST", path, body);
  return actions[name](desk, id, body);
}

// The reply as it is written: what is there already, then each new piece.
function events(id: string): EventStream {
  return {
    stream: (write, end) => {
      const now = liveReply(id);
      write("snapshot", now ?? { text: "" });
      if (!now || now.error) return (end(), () => undefined);
      return listen(id, (event) => {
        write(event.type, event);
        if (event.type === "done" || event.type === "failed") end();
      });
    },
  };
}

function get(desk: ChatDesk, url: URL): JsonReply | EventStream | undefined {
  const path = url.pathname;
  if (path === "/api/chats") return overview(desk);
  const [, id = "", rest] = /^\/api\/chats\/([0-9a-f-]{36})(\/events)?$/.exec(path) ?? [];
  if (!id) return answerHistory(desk, "GET", path, Object.fromEntries(url.searchParams));
  return rest ? events(id) : thread(desk, id);
}

// Answers a chat request, or nothing when the path is not one of these.
export async function handleChatApi(
  desk: ChatDesk,
  request: IncomingMessage,
  url: URL,
): Promise<JsonReply | EventStream | undefined> {
  // Other APIs read the body themselves, so it is left alone for them.
  if (!/^\/api\/(chats|rules|task-budget)(\/|$)/.test(url.pathname)) return undefined;
  try {
    if (request.method === "GET") return get(desk, url);
    return request.method === "POST" ? await post(desk, request, url.pathname) : undefined;
  } catch (error) {
    if (error instanceof BadRequest)
      return { status: error.status, body: { error: error.message } };
    throw error;
  }
}
