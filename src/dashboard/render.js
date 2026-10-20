import { el, usd } from "./dom.js";
import { handoffLog } from "./log.js";
import { reviewCard } from "./review.js";

// Builds one task's thread in the agency chat from /api/tasks.

const statusNames = {
  planning: "Planning",
  awaiting_plan_approval: "Awaiting plan approval",
  running: "Running",
  awaiting_decision: "Awaiting decision",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const valueOf = (id) => document.getElementById(id)?.value ?? "";

function message({ author, text }) {
  const who = el("span", { class: "who" }, author === "owner" ? "You" : "Agency");
  return el("div", { class: `message ${author}` }, who, text);
}

function button(label, onclick, secondary = false) {
  return el(
    "button",
    { type: "button", class: secondary ? "secondary" : undefined, onclick },
    label,
  );
}

// Worked out by the runtime from model prices; a model with no known price
// leaves the plan without an estimate until the owner states one.
function estimateText(estimate, budgetUsd) {
  if (!estimate) return "No estimate yet.";
  if (estimate.unpriced.length > 0) {
    return `No price is known for ${estimate.unpriced.join(", ")}. State it with amora models price before approving.`;
  }
  return `Estimate ${usd(estimate.usd)} of a ${usd(budgetUsd)} budget, one attempt per step; retries cost more.`;
}

function planCard(task, roles, act) {
  const { plan } = task;
  const field = `revise-${task.id}`;
  const steps = plan.steps.map((step) =>
    el(
      "li",
      {},
      el("strong", {}, roles[step.worker] ?? step.worker),
      `: ${step.goal}`,
      step.acceptance ? el("span", { class: "meta" }, ` Done when: ${step.acceptance}`) : null,
    ),
  );
  return el(
    "div",
    { class: "card" },
    el("p", {}, el("strong", {}, "Plan. "), plan.summary),
    el("ol", {}, steps),
    el("p", { class: "meta" }, estimateText(plan.estimate, task.budgetUsd)),
    button("Approve the plan", () => act(task.id, "approve")),
    button("Cancel", () => act(task.id, "cancel"), true),
    el("label", { for: field }, "Ask for changes"),
    el("textarea", { id: field, rows: 2 }),
    button("Revise the plan", () => act(task.id, "revise", { feedback: valueOf(field) }), true),
  );
}

function decisionCard(task, act) {
  const finished = task.plan && task.step >= task.plan.steps.length;
  const field = `budget-${task.id}`;
  const retryWithBudget = () =>
    act(task.id, "decide", { action: "retry", budgetUsd: Number(valueOf(field)) });
  return el(
    "div",
    { class: "card" },
    finished
      ? button("Complete the task", () => act(task.id, "decide", { action: "complete" }))
      : null,
    finished ? null : button("Try again", () => act(task.id, "decide", { action: "retry" })),
    button("Cancel the task", () => act(task.id, "decide", { action: "cancel" }), true),
    el("label", { for: field }, "Or try again with a new budget in USD"),
    el("input", { id: field, type: "number", min: "0.01", step: "0.01", value: task.budgetUsd }),
    button("Try again with this budget", retryWithBudget, true),
  );
}

function progress(task, roles) {
  const steps = task.plan?.steps ?? [];
  const step = steps[task.step];
  if (task.status === "planning")
    return el("p", { class: "meta" }, "The Planner / Decomposer is drafting a plan.");
  if (task.status === "paused") return el("p", { class: "meta" }, "Paused. Resume to continue.");
  if (task.status !== "running" || !step) return null;
  const role = roles[step.worker] ?? step.worker;
  return el(
    "p",
    { class: "meta" },
    `Step ${task.step + 1} of ${steps.length}: ${role}, attempt ${task.attempt + 1}.`,
  );
}

export function renderThread(task, roles, act) {
  const spent = `${statusNames[task.status] ?? task.status}, spent ${usd(task.spentUsd)} of ${usd(task.budgetUsd)}`;
  return el(
    "article",
    { class: "thread" },
    el("p", { class: "status" }, spent),
    task.messages.map(message),
    progress(task, roles),
    task.status === "awaiting_plan_approval" && task.plan ? planCard(task, roles, act) : null,
    task.status === "awaiting_decision" ? reviewCard(task, act) : null,
    task.status === "awaiting_decision" ? decisionCard(task, act) : null,
    handoffLog(task, roles),
  );
}
