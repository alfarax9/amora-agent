// The app's pages live in the address, as paths the runtime serves: a link
// or a reload lands where it points. Links inside the app move without a
// reload; the addresses the dashboard used before, such as #task-<id>, are
// sent to the paths that replaced them.

const id = "([0-9a-f-]{36})";

// Each page, and the mode it belongs to; the agency's pages and Settings
// keep the mode the owner came from.
const routes = [
  [/^\/$/, () => ({ page: "chat", mode: "chat" })],
  [new RegExp(`^/chat/${id}$`), ([, chat]) => ({ page: "chat", id: chat, mode: "chat" })],
  [/^\/code$/, () => ({ page: "new", mode: "code" })],
  [new RegExp(`^/code/${id}$`), ([, task]) => ({ page: "task", id: task, mode: "code" })],
  [/^\/artifacts$/, () => ({ page: "artifacts", mode: "chat" })],
  [/^\/agency$/, () => ({ page: "overview" })],
  [/^\/agency\/tasks$/, () => ({ page: "tasks" })],
  [new RegExp(`^/agency/tasks/${id}$`), ([, task]) => ({ page: "task", id: task })],
  [/^\/agency\/(workers|models|costs)$/, ([, page]) => ({ page })],
  [/^\/settings$/, () => ({ page: "settings" })],
  [/^\/setup$/, () => ({ page: "setup" })],
];

export function routeOf(pathname = globalThis.location.pathname) {
  for (const [pattern, route] of routes) {
    const match = pattern.exec(pathname);
    if (match) return route(match);
  }
  return { page: "chat", mode: "chat" };
}

const oldPages = {
  "#chat": "/",
  "#new": "/code",
  "#overview": "/agency",
  "#tasks": "/agency/tasks",
  "#workers": "/agency/workers",
  "#models": "/agency/models",
  "#costs": "/agency/costs",
  "#settings": "/settings",
};

function pathOfHash(hash) {
  const [, kind, found] = /^#(task|chat)-([0-9a-f-]{36})$/.exec(hash) ?? [];
  if (kind) return kind === "task" ? `/code/${found}` : `/chat/${found}`;
  return oldPages[hash];
}

const changed = () => globalThis.dispatchEvent(new Event("amora:route"));

export function go(path, { replace = false } = {}) {
  const here = globalThis.location.pathname + globalThis.location.search;
  if (path === here && !replace) return;
  globalThis.history[replace ? "replaceState" : "pushState"]({}, "", path);
  changed();
}

// Paths the runtime answers itself are left to the browser.
const ownPath = (path) => !/^\/(api|auth|connect|dashboard)(\/|$)/.test(path);

// A plain left click on a link inside the app; anything else is the browser's.
const plainClick = (event, link) =>
  event.button === 0 &&
  !event.defaultPrevented &&
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) &&
  !link.target;

function follow(event) {
  const link = event.target.closest?.("a[href]");
  if (!link || !plainClick(event, link)) return;
  const url = new URL(link.href);
  if (url.origin !== globalThis.location.origin || !ownPath(url.pathname)) return;
  event.preventDefault();
  go(url.pathname + url.search);
}

// Calls `onRoute` whenever the address changes, by a link, by go(), or by
// the browser's Back and Forward.
export function initRouter(onRoute) {
  const old = pathOfHash(globalThis.location.hash);
  if (old) globalThis.history.replaceState({}, "", old);
  document.addEventListener("click", follow);
  globalThis.addEventListener("popstate", changed);
  globalThis.addEventListener("amora:route", () => onRoute(routeOf()));
}
