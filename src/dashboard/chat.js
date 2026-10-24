import { call } from "./api.js";
import { openArtifact } from "./artifacts.js";
import { deleteChat, exportChat, renameChat, renderChatList } from "./chat-list.js";
import { brainText, homeView, messageView, reply, threadHead } from "./chat-view.js";
import { el } from "./dom.js";
import { go } from "./router.js";

// Chat: conversations with the agency (app spec §8). A question is answered
// by the Assistant as it streams in; work becomes a task, shown as its cards.
// / is a new chat and /chat/<id> one chat. Replies stream as server-sent
// events; Stop keeps what was written, and every retry and edit is a version.

const $ = (id) => document.getElementById(id);
const composer = $("chat-composer");
const input = $("chat-input");
const send = $("chat-send");
const intent = $("chat-intent");
const error = $("chat-error");
const state = { list: { chats: [], trash: [] }, brain: null, thread: null, live: null, id: null };
let app;
let root;
let events;
let editing = null;

const streaming = () => Boolean(state.live && !state.live.error);

function announce(text) {
  $("live").textContent = text;
}

function stored(key, value) {
  try {
    if (value === undefined) return globalThis.localStorage.getItem(key) ?? "";
    if (value) globalThis.localStorage.setItem(key, value);
    else globalThis.localStorage.removeItem(key);
  } catch {
    return "";
  }
  return value;
}

const draftKey = () => `amora.draft.${state.id ?? "new"}`;

function drawList() {
  const changed = (reply) => {
    state.list = { chats: reply.chats, trash: reply.trash ?? state.list.trash };
    drawList();
    if (state.id && state.thread) void open(state.id);
  };
  $("chat-list").replaceChildren(...renderChatList(state.list, state.id, changed));
}

function drawComposer() {
  const [text, detail] = brainText(state.brain);
  $("chat-brain").textContent = text;
  $("chat-brain").title = detail;
  send.textContent = streaming() ? "■" : "↑";
  send.setAttribute("aria-label", streaming() ? "Stop the reply" : "Send");
  send.title = streaming() ? "Stop (Esc)" : "Send (Enter)";
  send.classList.toggle("ready", streaming() || input.value.trim() !== "");
  const project = app.data?.project;
  $("chat-note").textContent =
    intent.value === "task"
      ? `Work runs on ${project ?? "no project yet: choose one in Octa Code"}.`
      : "";
}

const handlers = {
  act: (...args) => app.act(...args),
  show: (id) => void post(`/api/chats/${state.id}/branch`, { messageId: id }),
  retry: (messageId) => void post(`/api/chats/${state.id}/retry`, messageId ? { messageId } : {}),
  edit: (message, text) => {
    editing = null;
    void post(`/api/chats/${state.id}/edit`, {
      messageId: message.id,
      message: text,
      intent: intent.value,
    });
  },
  startEdit: (id) => ((editing = id), drawThread()),
  redraw: () => ((editing = null), drawThread()),
  saveCode: (code, language) => void saveCode(code, language),
};

function drawThread() {
  if (!state.thread) return;
  const { chat, messages } = state.thread;
  const view = { data: app.data, brain: state.brain, editing };
  const live = state.live
    ? reply(
        {
          worker: "assistant",
          text: state.live.text,
          streaming: !state.live.error,
          failed: state.live.error,
          versions: [],
        },
        view,
        handlers,
      )
    : null;
  // A reply being written replaces what followed the message it answers.
  const answering = state.live ? messages.findIndex(({ id }) => id === state.live.parentId) : -1;
  const shown = answering >= 0 ? messages.slice(0, answering + 1) : messages;
  const list = el(
    "ol",
    { class: "messages chat-messages" },
    shown.map((message) => messageView(message, view, handlers)),
    live,
  );
  const thread = el("div", { class: "thread chat-thread" }, list);
  const old = root.querySelector(".chat-thread");
  const atEnd = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 80;
  const top = old?.scrollTop ?? 0;
  shell().replaceChildren(threadHead(chat, chatActions(chat)), thread);
  thread.scrollTop = atEnd ? thread.scrollHeight : top;
  drawComposer();
}

function chatActions(chat) {
  const changed = (listed) => (
    (state.list = { chats: listed.chats, trash: listed.trash }),
    drawList(),
    void open(chat.id)
  );
  return {
    rename: () => void renameChat(chat, changed),
    star: () =>
      void call("POST", `/api/chats/${chat.id}/star`, { starred: !chat.starred }).then(changed),
    exportChat: () => void exportChat(chat.id),
    remove: () => void deleteChat(chat, (listed) => ((state.list = listed), drawList()), true),
  };
}

// The thread redraws as a reply streams in; the composer stays where it is,
// so what the owner types and where the cursor is are never disturbed.
function shell() {
  let body = root.querySelector(".chat-body");
  if (!body) {
    body = el("div", { class: "chat-body" });
    root.replaceChildren(body, composer);
  }
  return body;
}

function drawHome() {
  const start = homeView(app.data, (text) => {
    input.value = text;
    input.focus();
    drawComposer();
  });
  root.replaceChildren(start);
  start.append(composer);
  input.focus();
  drawComposer();
}

function follow(id) {
  events?.close();
  announce("AMORA is replying.");
  events = new globalThis.EventSource(`/api/chats/${id}/events`);
  const update = (change) => {
    if (state.id !== id) return events.close();
    change();
    drawThread();
  };
  const parse = (event) => JSON.parse(event.data);
  events.addEventListener("snapshot", (event) => update(() => (state.live = parse(event))));
  events.addEventListener("text", (event) =>
    update(
      () => (state.live = { ...state.live, text: (state.live?.text ?? "") + parse(event).text }),
    ),
  );
  events.addEventListener("reset", () => update(() => (state.live = { ...state.live, text: "" })));
  events.addEventListener("failed", (event) => {
    update(() => (state.live = { ...state.live, error: parse(event).error }));
    events.close();
  });
  const finish = () => (events.close(), announce("The reply is done."), void open(id));
  // The connection itself failing: the stored chat says where it stands.
  events.addEventListener("error", finish);
  events.addEventListener("done", finish);
}

async function open(id) {
  const thread = await call("GET", `/api/chats/${id}`);
  if (state.id !== id) return;
  state.thread = thread;
  state.live = thread.pending;
  drawThread();
  if (streaming()) follow(id);
}

async function post(path, body) {
  error.textContent = "";
  try {
    const reply = await call("POST", path, body);
    state.thread = reply;
    state.live = reply.pending;
    drawThread();
    if (streaming()) follow(state.id);
  } catch (failure) {
    error.textContent = failure.message;
  }
}

async function loadList() {
  const overview = await call("GET", "/api/chats");
  state.list = { chats: overview.chats, trash: overview.trash };
  state.brain = overview.brain;
  drawList();
}

// Shows / or /chat/<id> in `container`.
export async function showChat(container, id) {
  root = container;
  state.id = id;
  state.thread = null;
  state.live = null;
  editing = null;
  composer.hidden = false;
  error.textContent = "";
  input.value = stored(draftKey());
  await loadList();
  if (!id) return drawHome();
  root.replaceChildren(
    el("div", { class: "page" }, el("p", { class: "meta" }, "Opening the chat…")),
  );
  await open(id);
}

async function submit() {
  const text = input.value.trim();
  if (streaming()) return void call("POST", `/api/chats/${state.id}/stop`);
  if (!text) return;
  const path = state.id ? `/api/chats/${state.id}/messages` : "/api/chats";
  const draft = draftKey();
  try {
    const reply = await call("POST", path, { message: text, intent: intent.value });
    input.value = "";
    input.style.height = "";
    stored(draft, "");
    if (!state.id) return go(`/chat/${reply.chat.id}`);
    state.thread = reply;
    state.live = reply.pending ?? null;
    drawThread();
    if (streaming()) follow(state.id);
    void loadList();
    void app.refresh();
  } catch (failure) {
    error.textContent = failure.message;
  }
}

async function saveCode(code, language) {
  const title = `${language || "Code"} from ${state.thread?.chat.title ?? "a chat"}`;
  try {
    const { artifact } = await call("POST", "/api/artifacts", {
      title,
      kind: "code",
      language,
      content: code,
      chatId: state.id,
    });
    openArtifact(artifact.id);
  } catch (failure) {
    error.textContent = failure.message;
  }
}

// The cards follow their tasks: each poll that changed something redraws them.
// The home page's suggestions wait for the first poll, which says which
// divisions are installed.
export function tasksChanged() {
  if (state.thread?.messages.some(({ kind }) => kind === "card")) drawThread();
  const home = !state.id && root?.querySelector(".chat-start");
  if (home && !home.querySelector(".suggestions") && app.data) drawHome();
}

export function initChat(context) {
  app = context;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, globalThis.innerHeight * 0.4)}px`;
    stored(draftKey(), input.value);
    drawComposer();
  });
  intent.addEventListener("change", drawComposer);
  send.addEventListener("click", () => void submit());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && streaming() && !composer.hidden)
      void call("POST", `/api/chats/${state.id}/stop`);
  });
}

export function leaveChat() {
  events?.close();
  state.id = null;
  composer.hidden = true;
  document.body.append(composer);
}
