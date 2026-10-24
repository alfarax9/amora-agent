import { el, usd } from "./dom.js";
import { needsOwner, statusNames, titleOf } from "./sidebar.js";

// Tasks: every recent task with where it stands, newest first.

function stepText(task) {
  const steps = task.plan?.steps.length ?? 0;
  if (steps === 0) return "—";
  return `${Math.min(task.step + 1, steps)} of ${steps}`;
}

function row(task) {
  const kind = needsOwner(task)
    ? "waiting"
    : task.status === "running"
      ? "active"
      : task.status === "failed"
        ? "failed"
        : "";
  return el(
    "tr",
    {},
    el("td", {}, el("a", { href: `/code/${task.id}` }, titleOf(task))),
    el("td", { class: kind }, statusNames[task.status] ?? task.status),
    el("td", { class: "wide-only" }, stepText(task)),
    el("td", { class: "wide-only" }, String(task.attempt + 1)),
    el("td", { class: "right" }, `${usd(task.spentUsd)} of ${usd(task.budgetUsd)}`),
    el("td", { class: "right wide-only" }, new Date(task.createdAt).toLocaleString()),
  );
}

export function renderTasks(data) {
  const head = el(
    "tr",
    {},
    el("th", {}, "Session"),
    el("th", {}, "Status"),
    el("th", { class: "wide-only" }, "Step"),
    el("th", { class: "wide-only" }, "Attempt"),
    el("th", { class: "right" }, "Cost"),
    el("th", { class: "right wide-only" }, "Started"),
  );
  const tasks = [...data.tasks].reverse();
  const body =
    tasks.length > 0
      ? el("table", { class: "row-link" }, el("thead", {}, head), el("tbody", {}, tasks.map(row)))
      : el("p", { class: "empty-note" }, "No sessions yet. Start one with New session.");
  return el(
    "div",
    { class: "page" },
    el(
      "div",
      { class: "page-head" },
      el("h1", {}, "Sessions"),
      el("a", { class: "primary", href: "/code" }, "New session"),
    ),
    el("section", { class: "box" }, body),
  );
}
