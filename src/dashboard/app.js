import { leaveChat, initChat, renderChatList, showChat } from "./chat.js";
import { el, usd } from "./dom.js";
import { renderOverview } from "./overview.js";
import { renderPanel } from "./panel.js";
import { drawProjectChip, initProjects, openPicker } from "./projects.js";
import { loadReport, renderReport, reportPages } from "./reports.js";
import { setupNotice } from "./setup.js";
import { renderThread, threadHead } from "./render.js";
import { needsOwner, renderRecent } from "./sidebar.js";
import { renderTasks } from "./tasks.js";
import { drawTopbar } from "./topbar.js";

// The dashboard, after the AMORA website, in two modes as the Claude app has
// chat and code: Chat (#chat, #chat-<id>, chat.js) talks with a model, and
// Octa Code works with the team (#new, #task-<id>, #overview, #tasks,
// #workers, #models, #costs). #settings belongs to both. The code side polls
// the runtime every two seconds and re-renders only when something changed.

const $ = (id) => document.getElementById(id);
const app = $("app");
const main = $("view");
const panel = $("panel");
const composer = $("composer");
const brief = $("brief");
const actionError = $("action-error");

const wide = globalThis.matchMedia("(min-width: 1100px)").matches;
const view = { route: routeOf(), tab: "plan", panelOpen: wide, composer: "new" };
view.choose = (tab) => ((view.tab = tab), draw(true));
view.togglePanel = () => ((view.panelOpen = !view.panelOpen), draw(true));
let data;
let shown = "";
let heard = "";

// A first visit opens a new chat, as the Claude app does.
function routeOf() {
  const hash = globalThis.location.hash;
  const [, kind, id] = /^#(task|chat)-([0-9a-f-]{36})$/.exec(hash) ?? [];
  if (kind) return { page: kind, id };
  const page = hash.slice(1) || "chat";
  const pages = ["chat", "tasks", "new", "settings", ...reportPages];
  return { page: pages.includes(page) ? page : "overview" };
}

// Settings keeps whichever mode the owner came from.
function modeOf(route) {
  if (route.page === "settings") return app.dataset.mode;
  return route.page === "chat" ? "chat" : "code";
}

async function call(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("The runtime is not answering. Is amora still running?");
  }
  const reply = await response.json().catch(() => ({}));
  // The status rides along, so a caller can tell a refusal from a missing feature.
  if (!response.ok) {
    const message = reply.error ?? "The runtime could not do that. Check its log.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return reply;
}

// A re-render replaces fields and open diffs, so what the owner typed, which
// field had focus, which diffs were open, and how far it was scrolled are kept.
function keep(container, render) {
  const fields = [...container.querySelectorAll("textarea, input")];
  const values = new Map(fields.map((field) => [field.id, field.value]));
  const open = [...container.querySelectorAll("details[open]")].map((item) => item.id);
  const focused = document.activeElement?.id;
  const scrolled = [...container.querySelectorAll(".page, .thread, .panel-body")].map(
    (part) => part.scrollTop,
  );
  render();
  for (const [id, value] of values) if (id && $(id)) $(id).value = value;
  for (const id of open) $(id)?.setAttribute("open", "");
  [...container.querySelectorAll(".page, .thread, .panel-body")].forEach((part, index) => {
    part.scrollTop = scrolled[index] ?? 0;
  });
  if (focused && container.contains($(focused))) $(focused).focus();
}

function drawSidebar() {
  for (const item of document.querySelectorAll(".nav-item")) {
    const current =
      item.dataset.route === view.route.page ||
      (item.dataset.route === "tasks" && view.route.page === "task");
    if (current) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  const waiting = data.tasks.filter(needsOwner).length;
  $("decision-count").hidden = waiting === 0;
  $("decision-count").textContent = String(waiting);
  $("recent").replaceChildren(...renderRecent(data.tasks, view.route.id));
  for (const mode of document.querySelectorAll(".mode")) {
    mode.toggleAttribute("aria-current", mode.dataset.mode === app.dataset.mode);
  }
  const limit =
    data.dailyUsd === null
      ? "No daily limit is set yet, so no task can be approved."
      : `Daily limit ${usd(data.dailyUsd)}; spent today ${usd(data.spentTodayUsd)}.`;
  $("settings-budget").textContent = limit;
}

const openTask = (id, tab) => {
  view.tab = tab;
  view.panelOpen = true;
  globalThis.location.hash = `#task-${id}`;
};

function startPage() {
  const project = data.project ? `New sessions work on a copy of ${data.project}.` : null;
  return el(
    "div",
    { class: "start" },
    el("h1", {}, "What should the agency build?"),
    project ? el("p", { class: "meta" }, project) : null,
    setupNotice(data.readiness, () => void openPicker()),
  );
}

function taskPage(task) {
  const banner = data.paused
    ? el("p", { class: "banner" }, "All workers are paused. Resume them from the top bar.")
    : null;
  const thread = el(
    "div",
    { class: "thread" },
    banner,
    renderThread(task, data, act, () => openTask(task.id, "changes")),
  );
  return [threadHead(task, view, act), thread];
}

function pageFor(task) {
  if (view.route.page === "task" && task) return taskPage(task);
  if (view.route.page === "task")
    return [
      el(
        "div",
        { class: "page" },
        el("p", { class: "empty-note" }, "This session is not among the recent ones."),
      ),
    ];
  if (view.route.page === "new") return [startPage()];
  if (view.route.page === "tasks") return [renderTasks(data)];
  if (reportPages.includes(view.route.page)) return [renderReport(view.route.page, data)];
  return [renderOverview(data, act, openTask)];
}

const closedNotes = {
  planning: "The agency is on it…",
  running: "The agency is working on this task…",
  paused: "This task is paused.",
  awaiting_decision: "Decide above: complete, try again, or cancel.",
};

// The composer starts a task on the new-task page, revises a plan that waits
// for approval, and is closed while the agency works or once a task ended.
function placeComposer(task) {
  const page = view.route.page;
  composer.hidden = !(page === "new" || (page === "task" && task));
  if (composer.hidden) return;
  (page === "new" ? main.querySelector(".start") : main).append(composer);
  const mode =
    page === "new" ? "new" : task.status === "awaiting_plan_approval" ? "revise" : "closed";
  view.composer = mode;
  brief.placeholder = {
    new: "Message the agency",
    revise: "Ask for changes to the plan",
    closed:
      closedNotes[task?.status] ?? "This session has ended. Start a new one with New session.",
  }[mode];
  brief.disabled = mode === "closed";
  drawProjectChip(data, mode === "new");
  $("budget-field").hidden = mode !== "new";
  $("composer-note").textContent = composerNote(mode);
  readySend();
}

// A new task waits for the setup the runtime asks for; it would be refused.
// A question needs no project, so a missing project alone does not hold
// sending; the runtime refuses a task that needs one, and says why.
const blocked = () =>
  view.composer === "new" && (data?.readiness ?? []).some(({ fix }) => fix !== "project");

const noProject = () => (data?.readiness ?? []).some(({ fix }) => fix === "project");

function composerNote(mode) {
  if (mode === "revise") return "Your reply revises the plan.";
  if (mode !== "new") return "";
  if (blocked()) return "Sending opens once the setup above is done.";
  return noProject() ? "Questions are answered now; work needs a project." : "";
}

function readySend() {
  const ready = !brief.disabled && brief.value.trim() !== "" && !blocked();
  $("send").classList.toggle("ready", ready);
  $("send").disabled = !ready;
}

// New messages scroll into view, as in any chat, and so does a task opened.
function followThread(task) {
  const latest = task
    ? `${task.id}:${task.messages.length}:${task.handoffs.length}:${task.status}`
    : "";
  const thread = main.querySelector(".thread");
  if (thread && latest !== heard) thread.scrollTop = thread.scrollHeight;
  heard = latest;
}

function draw(force = false) {
  if (!data) return;
  const task =
    view.route.page === "task" ? data.tasks.find(({ id }) => id === view.route.id) : null;
  const snapshot = JSON.stringify([data, view.route, view.tab, view.panelOpen]);
  if (snapshot === shown && !force) return;
  shown = snapshot;
  drawTopbar(data, app);
  drawSidebar();
  if (view.route.page === "chat") return void (panel.hidden = true);
  $("settings-view").hidden = view.route.page !== "settings";
  main.hidden = view.route.page === "settings";
  document.body.append(composer);
  keep(main, () => main.replaceChildren(...pageFor(task)));
  placeComposer(task);
  followThread(task);
  panel.hidden = !(task && view.panelOpen);
  if (!panel.hidden)
    keep(panel, () => panel.replaceChildren(...renderPanel(task, data.roles, act, view)));
}

async function refresh() {
  try {
    data = await call("GET", "/api/tasks");
    actionError.textContent = "";
    void loadReport(view.route.page, () => draw(true));
    draw();
  } catch (error) {
    actionError.textContent = error.message;
  }
}

// Says whether the runtime accepted the action, so a form can clear itself.
async function act(id, action, body = {}) {
  actionError.textContent = "";
  let accepted = true;
  try {
    await call("POST", `/api/tasks/${id}/${action}`, body);
  } catch (error) {
    actionError.textContent = error.message;
    accepted = false;
  }
  await refresh();
  return accepted;
}

async function submit() {
  $("composer-error").textContent = "";
  const text = brief.value.trim();
  if (text === "" || view.composer === "closed") return;
  try {
    if (view.composer === "revise") {
      await call("POST", `/api/tasks/${view.route.id}/revise`, { feedback: text });
    } else {
      const budgetUsd = Number($("budget").value);
      const { task } = await call("POST", "/api/tasks", { brief: text, budgetUsd });
      globalThis.location.hash = `#task-${task.id}`;
    }
    brief.value = "";
    brief.style.height = "";
  } catch (error) {
    $("composer-error").textContent = error.message;
  }
  await refresh();
}

// Chat draws its own pages; the code side's composer and pages step aside.
function enter() {
  app.dataset.mode = modeOf(view.route);
  main.hidden = false;
  if (view.route.page !== "chat") return leaveChat();
  composer.hidden = true;
  $("settings-view").hidden = true;
  const listed = () => $("chat-list").replaceChildren(...renderChatList());
  showChat(main, view.route.id ?? null, listed).catch((error) => {
    actionError.textContent = error.message;
  });
}

function wire() {
  initProjects({ call, changed: refresh });
  initChat({ call });
  // Enter sends and Shift+Enter starts a new line, as in a chat.
  brief.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  brief.addEventListener("input", () => {
    brief.style.height = "auto";
    brief.style.height = `${brief.scrollHeight}px`;
    readySend();
  });
  $("send").addEventListener("click", () => void submit());
  $("toggle-sidebar").addEventListener("click", () => app.classList.toggle("sidebar-open"));
  $("pause").addEventListener("click", async () => {
    try {
      data = await call("POST", data?.paused ? "/api/resume" : "/api/pause");
      draw(true);
    } catch (error) {
      actionError.textContent = error.message;
    }
  });
  globalThis.addEventListener("hashchange", () => {
    view.route = routeOf();
    app.classList.remove("sidebar-open");
    enter();
    draw(true);
    void loadReport(view.route.page, () => draw(true));
    if (view.route.page === "new") brief.focus();
  });
}

wire();
enter();
void refresh().then(() => view.route.page === "new" && brief.focus());
setInterval(refresh, 2000);
