import { el } from "./dom.js";
import { markdown } from "./markdown.js";

// Chat: plain conversations with a model, as in a chat app, apart from the
// code team's sessions. #chat is a new chat; #chat-<id> is one chat, whose
// reply streams in as server-sent events and is drawn as Markdown.

const $ = (id) => document.getElementById(id);
const composer = $("chat-composer");
const input = $("chat-input");
const send = $("chat-send");
const picker = $("chat-model");
const error = $("chat-error");
const state = { chats: [], models: [], model: null, thread: null, live: null, id: null };
let call;
let root;
let events;

const shortName = (model) => model.split("/").at(-1) ?? model;

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function renderChatList() {
  if (state.chats.length === 0) return [el("p", { class: "meta task-link" }, "No chats yet.")];
  return state.chats.map((chat) =>
    el(
      "a",
      {
        class: "task-link",
        href: `#chat-${chat.id}`,
        title: chat.title,
        "aria-current": chat.id === state.id ? "page" : undefined,
      },
      chat.title,
    ),
  );
}

function drawPicker(current) {
  const options = state.models.length ? state.models : current ? [current] : [];
  picker.replaceChildren(
    ...options.map((model) =>
      el(
        "option",
        { value: model, selected: model === current ? "" : undefined },
        shortName(model),
      ),
    ),
  );
  picker.disabled = options.length === 0;
}

function copyButton(text) {
  const button = el("button", { type: "button", class: "ghost" }, "Copy");
  button.addEventListener("click", async () => {
    await globalThis.navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  });
  return button;
}

function reply(text, { streaming = false, failed = null } = {}) {
  const body = text
    ? markdown(text)
    : [el("span", { class: "typing" }, el("span"), el("span"), el("span"))];
  const actions = failed
    ? el(
        "div",
        { class: "reply-actions" },
        el("p", { class: "error" }, failed),
        el("button", { type: "button", class: "secondary", onclick: retry }, "Retry"),
      )
    : streaming
      ? null
      : el("div", { class: "reply-actions" }, copyButton(text));
  return el(
    "li",
    { class: "reply" },
    el("span", { class: "agency-mark", "aria-hidden": "true" }, "A"),
    el("div", { class: "reply-body" }, el("div", { class: "prose" }, body), actions),
  );
}

function message({ role, text }) {
  return role === "user"
    ? el("li", { class: "you" }, el("p", { class: "duo" }, text))
    : reply(text);
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

function drawThread() {
  const { chat, messages } = state.thread;
  const live = state.live;
  const list = el(
    "ol",
    { class: "messages chat-messages" },
    messages.map(message),
    live ? reply(live.text, { streaming: !live.error, failed: live.error ?? null }) : null,
  );
  const head = el(
    "header",
    { class: "thread-head" },
    el("h1", {}, chat.title),
    el("button", { type: "button", class: "ghost", onclick: remove }, "Delete"),
  );
  const thread = el("div", { class: "thread chat-thread" }, list);
  shell().replaceChildren(head, thread);
  thread.scrollTop = thread.scrollHeight;
  drawPicker(chat.model);
  input.placeholder = "Reply to AMORA…";
}

function drawHome() {
  const start = el(
    "div",
    { class: "start chat-start" },
    el("h1", {}, greeting()),
    el("p", { class: "meta" }, "Ask anything. For work on a project, start an Octa Code session."),
  );
  root.replaceChildren(start);
  start.append(composer);
  drawPicker(state.model);
  input.placeholder = "How can I help you today?";
  input.focus();
}

function follow(id) {
  events?.close();
  events = new globalThis.EventSource(`/api/chats/${id}/events`);
  const update = (change) => {
    if (state.id !== id) return events.close();
    change();
    drawThread();
  };
  events.addEventListener("snapshot", (event) =>
    update(() => (state.live = JSON.parse(event.data))),
  );
  events.addEventListener("text", (event) =>
    update(() => (state.live = { text: (state.live?.text ?? "") + JSON.parse(event.data).text })),
  );
  events.addEventListener("reset", () => update(() => (state.live = { text: "" })));
  events.addEventListener("failed", (event) => {
    update(
      () => (state.live = { text: state.live?.text ?? "", error: JSON.parse(event.data).error }),
    );
    events.close();
  });
  // The connection itself failing: the stored chat says where it stands.
  events.addEventListener("error", () => (events.close(), void open(id)));
  events.addEventListener("done", () => (events.close(), void open(id)));
}

async function open(id) {
  const thread = await call("GET", `/api/chats/${id}`);
  if (state.id !== id) return;
  state.thread = thread;
  state.live = thread.pending;
  drawThread();
  if (thread.pending && !thread.pending.error) follow(id);
}

async function loadChats() {
  const overview = await call("GET", "/api/chats");
  Object.assign(state, { chats: overview.chats, models: overview.models, model: overview.model });
}

// Shows #chat or #chat-<id> in `container`; the chat list is reloaded first.
export async function showChat(container, id, changed) {
  root = container;
  state.id = id;
  composer.hidden = false;
  error.textContent = "";
  await loadChats();
  changed();
  if (!id) return drawHome();
  state.thread = null;
  root.replaceChildren(
    el("div", { class: "page" }, el("p", { class: "meta" }, "Opening the chat…")),
  );
  await open(id);
}

async function submit() {
  const text = input.value.trim();
  // One reply at a time: the next message waits until this one is written.
  if (!text || (state.live && !state.live.error)) return;
  error.textContent = "";
  try {
    const path = state.id ? `/api/chats/${state.id}/messages` : "/api/chats";
    const body = state.id ? { message: text } : { message: text, model: picker.value || undefined };
    const reply = await call("POST", path, body);
    input.value = "";
    input.style.height = "";
    send.classList.remove("ready");
    if (!state.id) return void (globalThis.location.hash = `#chat-${reply.chat.id}`);
    state.thread = reply;
    state.live = reply.pending ?? { text: "" };
    drawThread();
    follow(state.id);
  } catch (failure) {
    error.textContent = failure.message;
  }
}

async function retry() {
  const reply = await call("POST", `/api/chats/${state.id}/retry`);
  state.thread = reply;
  state.live = { text: "" };
  drawThread();
  follow(state.id);
}

async function remove() {
  if (
    !globalThis.confirm(
      "Delete this chat? Its messages are removed; what it cost stays in today's spend.",
    )
  )
    return;
  await call("POST", `/api/chats/${state.id}/delete`);
  globalThis.location.hash = "#chat";
}

async function chooseModel() {
  const model = picker.value;
  const path = state.id ? `/api/chats/${state.id}/model` : "/api/chat/model";
  try {
    await call("POST", path, { model });
  } catch (failure) {
    error.textContent = failure.message;
  }
}

export function initChat(options) {
  call = options.call;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
    send.classList.toggle("ready", input.value.trim() !== "");
  });
  send.addEventListener("click", () => void submit());
  picker.addEventListener("change", () => void chooseModel());
}

export function leaveChat() {
  events?.close();
  state.id = null;
  composer.hidden = true;
  document.body.append(composer);
}
