import { el, usd } from "./dom.js";
import { needsOwner, renderRecent } from "./sidebar.js";

// The frame around every page: the sidebar's links and badge, its sessions
// grouped by repository, the footer's runtime state and spend, collapsing to
// a rail, and the mode switch, which reopens the last conversation of each
// mode. The tabs of the agency's pages are here too.

const $ = (id) => document.getElementById(id);
const app = $("app");

// Browser storage is a convenience: a private window may refuse it.
function stored(key, value) {
  try {
    if (value === undefined) return globalThis.localStorage.getItem(key);
    globalThis.localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return value;
}

const agencyPages = ["overview", "tasks", "workers", "models", "costs"];

// Where each mode was last, so switching back reopens it.
export function rememberPlace(mode) {
  const path = globalThis.location.pathname;
  const ownPage = mode === "chat" ? /^\/(chat\/|$)/ : /^\/code(\/|$)/;
  if (ownPage.test(path)) stored(`amora.last.${mode}`, path);
  $("mode-chat").href = stored("amora.last.chat") ?? "/";
  $("mode-code").href = stored("amora.last.code") ?? "/code";
}

function markCurrent(route) {
  const agency = agencyPages.includes(route.page) || route.page === "task";
  for (const item of document.querySelectorAll(".nav-item[data-route]")) {
    const current =
      item.dataset.route === route.page || (item.dataset.route === "agency" && agency);
    item.toggleAttribute("aria-current", current && !(route.page === "task" && route.mode));
  }
  for (const mode of document.querySelectorAll(".mode")) {
    mode.toggleAttribute("aria-current", mode.dataset.mode === app.dataset.mode);
  }
}

function drawFoot(data) {
  const status = $("foot-status");
  status.dataset.shape = data.paused ? "paused" : "running";
  status.querySelector(".label").textContent = data.paused ? "Runtime paused" : "Runtime ok";
  status.title = status.querySelector(".label").textContent;
  const limit = data.dailyUsd === null ? "no limit" : usd(data.dailyUsd);
  $("foot-spend").textContent = `${usd(data.spentTodayUsd)} / ${limit}`;
  $("address").textContent = globalThis.location.host;
}

export function drawShell({ view, data }) {
  markCurrent(view.route);
  const waiting = data.tasks.filter(needsOwner).length;
  $("decision-count").hidden = waiting === 0;
  $("decision-count").textContent = String(waiting);
  $("decision-count").title = `${waiting} waiting for your decision`;
  $("recent").replaceChildren(...renderRecent(data.tasks, view.route.id));
  drawFoot(data);
  $("settings-budget").textContent =
    data.dailyUsd === null
      ? "No daily limit is set yet, so no task can be approved."
      : `Daily limit ${usd(data.dailyUsd)}; spent today ${usd(data.spentTodayUsd)}.`;
}

const tabNames = {
  overview: "Overview",
  tasks: "Tasks",
  workers: "Workers",
  models: "Models",
  costs: "Costs",
};

export function agencyTabs(current) {
  const path = (page) => (page === "overview" ? "/agency" : `/agency/${page}`);
  return el(
    "nav",
    { class: "tabs agency-tabs", "aria-label": "Agency" },
    agencyPages.map((page) =>
      el(
        "a",
        {
          class: "tab",
          href: path(page),
          "aria-current": page === current ? "page" : undefined,
        },
        tabNames[page],
      ),
    ),
  );
}

export function toggleSidebar() {
  const collapsed = app.classList.toggle("collapsed");
  $("collapse").setAttribute("aria-pressed", String(collapsed));
  stored("amora.sidebar", collapsed ? "collapsed" : "open");
}

export function initShell() {
  if (stored("amora.sidebar") === "collapsed") toggleSidebar();
  $("collapse").addEventListener("click", toggleSidebar);
  $("toggle-sidebar").addEventListener("click", () => app.classList.toggle("sidebar-open"));
}
