import { call } from "./api.js";
import { showArtifacts } from "./artifacts.js";
import { initChat, leaveChat, showChat, tasksChanged } from "./chat.js";
import { initCode, placeComposer, startPage, taskPage } from "./code.js";
import { el } from "./dom.js";
import { renderOverview } from "./overview.js";
import { renderPanel } from "./panel.js";
import { initProjects } from "./projects.js";
import { loadReport, renderReport, reportPages } from "./reports.js";
import { go, initRouter, routeOf } from "./router.js";
import { initSearch } from "./search.js";
import { showSetup } from "./setup-page.js";
import { agencyTabs, drawShell, initShell, rememberPlace } from "./shell.js";
import { initShortcuts } from "./shortcuts.js";
import { renderTasks } from "./tasks.js";
import { drawTopbar } from "./topbar.js";

// The AMORA App: Chat (/ and /chat/<id>, chat.js), where the agency answers
// and takes on work, and Octa Code (/code and /code/<id>, code.js), sessions
// with the team on a project. The agency's pages (/agency/...), Artifacts,
// and Settings sit beside them. The runtime is polled every two seconds, and
// a page is drawn again only when something it shows changed.

const $ = (id) => document.getElementById(id);
const app = $("app");
const main = $("view");
const panel = $("panel");
const actionError = $("action-error");

const wide = globalThis.matchMedia("(min-width: 1280px)").matches;
const view = { route: routeOf(), tab: "plan", panelOpen: wide, composer: "new" };
view.choose = (tab) => ((view.tab = tab), draw(true));
view.togglePanel = () => ((view.panelOpen = !view.panelOpen), draw(true));
let data;
let shown = "";
let heard = "";

// Pages the app's scripts draw themselves, not from the polled tasks.
const ownPages = new Set(["chat", "artifacts", "setup"]);

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

const openTask = (id, tab) => {
  view.tab = tab;
  view.panelOpen = true;
  go(`/code/${id}`);
};

function pageFor(task) {
  const { page } = view.route;
  if (page === "task" && task) return taskPage(task);
  if (page === "task") {
    const note = el("p", { class: "empty-note" }, "This session is not among the recent ones.");
    return [el("div", { class: "page" }, note)];
  }
  if (page === "new") return [startPage()];
  if (page === "tasks") return [agencyTabs(page), renderTasks(data)];
  if (reportPages.includes(page)) return [agencyTabs(page), renderReport(page, data)];
  return [agencyTabs("overview"), renderOverview(data, act, openTask)];
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
  drawShell(context);
  tasksChanged(data);
  if (ownPages.has(view.route.page) || view.route.page === "settings") return;
  document.body.append($("composer"));
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

const context = {
  view,
  main,
  act,
  refresh,
  openTask,
  get data() {
    return data;
  },
};

// Each page decides what it shows; the code side's composer and panel step
// aside for the pages that draw themselves.
const titles = { chat: "Chat", new: "Octa Code", task: "Octa Code", artifacts: "Artifacts" };

function enter() {
  const { page, id } = view.route;
  const title = titles[page] ?? (page === "settings" || page === "setup" ? "Settings" : "Agency");
  document.title = `${title} · AMORA`;
  app.dataset.mode = view.route.mode ?? app.dataset.mode ?? "chat";
  rememberPlace(app.dataset.mode);
  $("settings-view").hidden = page !== "settings";
  main.hidden = page === "settings";
  panel.hidden = true;
  $("composer").hidden = true;
  if (page !== "chat") leaveChat();
  const shows = { chat: () => showChat(main, id ?? null), artifacts: () => showArtifacts(main) };
  shows.setup = () => showSetup(main);
  shows[page]?.().catch((error) => (actionError.textContent = error.message));
}

function wire() {
  initProjects({ call, changed: refresh });
  initChat(context);
  initCode(context);
  initShell(context);
  initSearch();
  initShortcuts();
  // Mod+. opens or closes the side panel where the page has one.
  globalThis.addEventListener("amora:panel", () =>
    view.route.page === "task"
      ? view.togglePanel()
      : (panel.hidden = !panel.hidden || !panel.firstChild),
  );
  $("pause").addEventListener("click", async () => {
    try {
      data = await call("POST", data?.paused ? "/api/resume" : "/api/pause");
      draw(true);
    } catch (error) {
      actionError.textContent = error.message;
    }
  });
  initRouter((route) => {
    view.route = route;
    app.classList.remove("sidebar-open");
    enter();
    draw(true);
    void loadReport(route.page, () => draw(true));
    if (route.page === "new") $("brief").focus();
  });
}

wire();
enter();
void refresh().then(() => view.route.page === "new" && $("brief").focus());
setInterval(refresh, 2000);
