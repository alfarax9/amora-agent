import { el } from "./dom.js";

// Status as a shape plus a word, never by color alone (app spec §10.3). A
// session in the sidebar is running, needs approval, idle, or done; the CSS
// draws each shape from data-shape.

const sessionStates = {
  planning: ["running", "Running"],
  running: ["running", "Running"],
  awaiting_plan_approval: ["approval", "Needs approval"],
  awaiting_decision: ["approval", "Needs approval"],
  paused: ["paused", "Paused"],
  completed: ["done", "Done"],
  failed: ["blocked", "Stopped"],
  cancelled: ["idle", "Cancelled"],
};

export function statusMark(shape, label, { compact = false } = {}) {
  return el(
    "span",
    { class: compact ? "status compact" : "status", "data-shape": shape, title: label },
    el("span", { class: "shape", "aria-hidden": "true" }),
    el("span", { class: compact ? "label sr-only" : "label" }, label),
  );
}

export function sessionStatus(task, options) {
  const [shape, label] = sessionStates[task.status] ?? ["idle", "Idle"];
  return statusMark(shape, label, options);
}
