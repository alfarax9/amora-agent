import { el } from "./dom.js";

// The sidebar's recent Octa Code sessions, grouped by project folder as Claude
// Code groups them, and the names the pages give each status.

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

const recentCount = 12;

// A question needs no project, so it has none.
const folderOf = (task) => task.project?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Questions";

function link(task, selected) {
  return el(
    "a",
    {
      class: "task-link",
      href: `#task-${task.id}`,
      title: titleOf(task),
      "aria-current": task.id === selected ? "page" : undefined,
    },
    titleOf(task),
  );
}

export function renderRecent(tasks, selected) {
  if (tasks.length === 0) return [el("p", { class: "meta task-link" }, "No sessions yet.")];
  const groups = new Map();
  for (const task of [...tasks].reverse().slice(0, recentCount)) {
    groups.set(folderOf(task), [...(groups.get(folderOf(task)) ?? []), task]);
  }
  return [...groups].flatMap(([folder, group]) => [
    el("p", { class: "group-title", title: group[0].project ?? undefined }, folder),
    ...group.map((task) => link(task, selected)),
  ]);
}
