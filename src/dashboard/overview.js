import { el, usd } from "./dom.js";
import { setupNotice } from "./setup.js";
import { needsOwner, titleOf } from "./sidebar.js";

// Overview, after the website's dashboard: what needs the owner first, then
// what is running, then which workers worked today and what they cost.

const activeStates = new Set(["planning", "running", "paused"]);

function stat(label, value, detail, highlighted = false) {
  return el(
    "div",
    { class: highlighted ? "stat duo" : "stat" },
    el("dt", {}, label),
    el("dd", {}, value, detail ? el("small", {}, detail) : null),
  );
}

function summary(data) {
  const active = data.tasks.filter((task) => activeStates.has(task.status)).length;
  const waiting = data.tasks.filter(needsOwner).length;
  const limit = data.dailyUsd === null ? "no daily limit" : `of ${usd(data.dailyUsd)}`;
  return el(
    "dl",
    { class: "cards" },
    stat("Active tasks", String(active)),
    stat("Needs your decision", String(waiting), null, waiting > 0),
    stat("Spent today", usd(data.spentTodayUsd), limit),
  );
}

function approvalText(task) {
  const name = titleOf(task).replace(/[.!?…]+$/, "");
  if (task.status === "awaiting_plan_approval") return `The plan for ${name} is ready`;
  const finished = task.plan && task.step >= task.plan.steps.length;
  return finished ? `${name} is ready for review` : `${name} needs a decision`;
}

function approvals(data, act, open) {
  return data.tasks.filter(needsOwner).map((task) => {
    const plan = task.status === "awaiting_plan_approval";
    const primary = plan
      ? el(
          "button",
          { type: "button", class: "primary", onclick: () => act(task.id, "approve") },
          "Approve",
        )
      : el(
          "button",
          { type: "button", class: "primary", onclick: () => open(task.id, "changes") },
          "Review",
        );
    return el(
      "div",
      { class: "approval duo" },
      el("p", {}, approvalText(task)),
      el("span", { class: "actions" }, [
        el("a", { class: "secondary", href: `#task-${task.id}` }, plan ? "View plan" : "Open"),
        primary,
      ]),
    );
  });
}

function stageClass(task, index) {
  if (index < task.step || task.status === "completed") return "done";
  return index === task.step && task.status === "running" ? "now" : "";
}

function pipeline(task, roles) {
  const steps = task.plan?.steps ?? [];
  const note = task.status === "planning" ? "Drafting a plan" : `Attempt ${task.attempt + 1}`;
  return el(
    "div",
    { class: "pipeline" },
    el(
      "p",
      { class: "pipeline-head" },
      el("a", { href: `#task-${task.id}` }, titleOf(task)),
      el("span", {}, note),
    ),
    steps.length > 0
      ? el(
          "ol",
          { class: "stages" },
          steps.map((step, index) =>
            el("li", { class: stageClass(task, index) }, roles[step.worker] ?? step.worker),
          ),
        )
      : null,
  );
}

function activeWork(data) {
  const tasks = data.tasks.filter((task) => activeStates.has(task.status));
  const body =
    tasks.length > 0
      ? tasks.map((task) => pipeline(task, data.roles))
      : el("p", { class: "empty-note" }, "Nothing is running.");
  return el("section", { class: "box" }, el("h2", {}, "Active work"), body);
}

const gateNames = { passed: "Passed", failed: "Gate failed", blocked: "Blocked" };

// Each worker's latest handoff today, its cost today, and whether it is the
// step a running task is on now.
function workersToday(data) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const working = new Set(
    data.tasks
      .filter((task) => task.status === "running")
      .map((task) => task.plan?.steps[task.step]?.worker),
  );
  const rows = new Map();
  for (const handoff of data.tasks.flatMap((task) => task.handoffs)) {
    if (handoff.sender === "owner" || new Date(handoff.createdAt) < since) continue;
    const row = rows.get(handoff.sender) ?? { cost: 0 };
    rows.set(handoff.sender, { ...row, last: handoff, cost: row.cost + handoff.costUsd });
  }
  return [...rows].map(([worker, row]) => ({ worker, ...row, working: working.has(worker) }));
}

function workerRow(row, data) {
  const division = data.divisions?.[row.worker];
  const status = row.working ? "Working" : (gateNames[row.last.gate] ?? row.last.validation);
  const kind = row.working ? "active" : row.last.gate === "failed" ? "failed" : "";
  return el(
    "tr",
    { style: division ? `--division: var(--division-${division})` : undefined },
    el(
      "td",
      {},
      el(
        "span",
        { class: "worker" },
        el("span", { class: "dot" }),
        data.roles[row.worker] ?? row.worker,
      ),
    ),
    el("td", { class: "wide-only" }, row.last.answeredBy || row.last.model),
    el("td", { class: kind }, status),
    el("td", { class: "right" }, usd(row.cost)),
  );
}

function workerActivity(data) {
  const rows = workersToday(data);
  const head = el(
    "tr",
    {},
    el("th", {}, "Worker"),
    el("th", { class: "wide-only" }, "Model"),
    el("th", {}, "Status"),
    el("th", { class: "right" }, "Today"),
  );
  const body =
    rows.length > 0
      ? el(
          "table",
          {},
          el("thead", {}, head),
          el(
            "tbody",
            {},
            rows.map((row) => workerRow(row, data)),
          ),
        )
      : el("p", { class: "empty-note" }, "No worker has worked today.");
  return el("section", { class: "box" }, el("h2", {}, "Worker activity today"), body);
}

export function renderOverview(data, act, open) {
  return el(
    "div",
    { class: "page" },
    el("div", { class: "page-head" }, el("h1", {}, "Overview")),
    setupNotice(data.readiness),
    summary(data),
    approvals(data, act, open),
    activeWork(data),
    workerActivity(data),
  );
}
