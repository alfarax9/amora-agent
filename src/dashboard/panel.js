import { el } from "./dom.js";
import { handoffLog } from "./log.js";
import { reviewCard } from "./review.js";

// The details panel beside the conversation: the plan as a checklist, the
// changes Complete would make, and the handoff log.

const tabs = [
  ["plan", "Plan"],
  ["changes", "Changes"],
  ["log", "Log"],
];

const finishedStates = new Set(["completed", "awaiting_decision"]);

// A step is done once the task has moved past it; the step a running task is
// on is the current one.
function markOf(task, index) {
  if (index < task.step || (index === task.step && task.status === "completed")) {
    return ["done", "✓"];
  }
  if (index === task.step && task.status === "running") return ["now", "●"];
  return ["", "○"];
}

function planTab(task, roles) {
  if (!task.plan) return el("p", { class: "meta" }, "The plan appears here once it is drafted.");
  const items = task.plan.steps.map((step, index) => {
    const [kind, glyph] = markOf(task, index);
    return el(
      "li",
      {},
      el("span", { class: `mark ${kind}`, "aria-hidden": "true" }, glyph),
      el(
        "div",
        {},
        el("strong", {}, roles[step.worker] ?? step.worker),
        el("div", {}, step.goal),
        step.acceptance ? el("div", { class: "meta" }, `Done when: ${step.acceptance}`) : null,
      ),
    );
  });
  return [el("p", {}, task.plan.summary), el("ol", { class: "steps" }, items)];
}

function changesTab(task, act) {
  const card = reviewCard(task, act);
  if (card) return card;
  const why = finishedStates.has(task.status)
    ? "There are no changes left to review."
    : "The changes appear here once every step has passed.";
  return el("p", { class: "meta" }, why);
}

function logTab(task, roles) {
  return handoffLog(task, roles) ?? el("p", { class: "meta" }, "No handoffs yet.");
}

export function renderPanel(task, roles, act, view) {
  const body = {
    plan: () => planTab(task, roles),
    changes: () => changesTab(task, act),
    log: () => logTab(task, roles),
  }[view.tab]();
  const bar = el(
    "div",
    { class: "tabs", role: "tablist" },
    tabs.map(([id, label]) =>
      el(
        "button",
        {
          type: "button",
          class: "tab",
          role: "tab",
          "aria-selected": String(view.tab === id),
          onclick: () => view.choose(id),
        },
        label,
      ),
    ),
  );
  return [bar, el("div", { class: "panel-body", role: "tabpanel" }, body)];
}
