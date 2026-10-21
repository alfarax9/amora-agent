import { el } from "./dom.js";

// The sidebar's recent tasks, and the names the pages give each status.

export const statusNames = {
  planning: "Planning",
  awaiting_plan_approval: "Awaiting plan approval",
  running: "Running",
  awaiting_decision: "Awaiting decision",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const needsOwner = (task) =>
  task.status === "awaiting_plan_approval" || task.status === "awaiting_decision";

export function titleOf(task) {
  const line = task.brief.split("\n")[0].trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

const recentCount = 8;

export function renderRecent(tasks, selected) {
  if (tasks.length === 0) return [el("p", { class: "meta task-link" }, "No tasks yet.")];
  return [...tasks]
    .reverse()
    .slice(0, recentCount)
    .map((task) =>
      el(
        "a",
        {
          class: "task-link",
          href: `#task-${task.id}`,
          title: titleOf(task),
          "aria-current": task.id === selected ? "page" : undefined,
        },
        titleOf(task),
      ),
    );
}
