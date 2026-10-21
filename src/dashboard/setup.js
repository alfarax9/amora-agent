import { el } from "./dom.js";

// What the agency still needs before a task can start (readiness.ts in the
// runtime), each gap with the command that closes it. The runtime refuses a
// new task until the list is empty, so the page says so before the owner
// writes a brief.

export function setupNotice(gaps) {
  if (!gaps?.length) return null;
  return el(
    "section",
    { class: "setup duo", "aria-labelledby": "setup-title" },
    el("h2", { id: "setup-title" }, "Set up the agency before the first task"),
    el(
      "ol",
      {},
      gaps.map(({ problem, command }) =>
        el("li", {}, el("p", {}, problem), el("code", { class: "command" }, command)),
      ),
    ),
    el("p", { class: "meta" }, "Run these in a terminal; this page updates by itself."),
  );
}
