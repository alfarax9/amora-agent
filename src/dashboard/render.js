import { el, usd } from "./dom.js";
import { statusNames, titleOf } from "./sidebar.js";

// A task's thread, after the website's agent thread: yours on the right in
// the duo border; the agency's and each worker's on the left under a mark or
// the worker's division mascot, in the division's color. A worker's message is
// its handoff: what it handed on, to whom, and what the gate said.

const valueOf = (id) => document.getElementById(id)?.value ?? "";
const count = (changes) => (changes.length === 1 ? "1 file" : `${changes.length} files`);

export function divisionStyle(division) {
  return division ? `--division: var(--division-${division})` : undefined;
}

export function mascot(division) {
  if (!division) return el("span", { class: "agency-mark", "aria-hidden": "true" }, "A");
  return el("img", { class: "mascot", src: `/dashboard/mascots/${division}.svg`, alt: "" });
}

function fromBubble(name, division, text, detail) {
  return el(
    "li",
    { class: "from", style: divisionStyle(division) },
    mascot(division),
    el(
      "div",
      { class: "bubble" },
      el("p", { class: "name" }, name),
      el("p", { class: "text" }, text),
      detail,
    ),
  );
}

function ownerBubble(text) {
  return el("li", { class: "you" }, el("p", { class: "duo" }, text));
}

const gateText = {
  passed: "gate passed",
  failed: "gate failed",
  blocked: "gate blocked",
  none: "",
};

function handoffBubble(handoff, data) {
  const role = (id) => (id === "owner" ? "you" : (data.roles[id] ?? id));
  const gate = [gateText[handoff.gate], handoff.gateReason].filter(Boolean).join(": ");
  const facts = [
    `${handoff.contract} to ${role(handoff.receiver)}`,
    handoff.validation,
    gate,
    handoff.answeredBy || handoff.model,
    usd(handoff.costUsd),
  ];
  const detail = el(
    "p",
    { class: handoff.gate === "failed" ? "detail failed" : "detail" },
    facts.filter(Boolean).join(" · "),
  );
  const text = handoff.summary ?? `Handed ${handoff.contract} to ${role(handoff.receiver)}.`;
  return fromBubble(role(handoff.sender), data.divisions?.[handoff.sender], text, detail);
}

// Messages and handoffs in the order they happened.
function timeline(task) {
  const said = task.messages.map((message) => ({ at: message.createdAt, message }));
  const handed = task.handoffs
    .filter((handoff) => handoff.sender !== "owner")
    .map((handoff) => ({ at: handoff.createdAt, handoff }));
  return [...said, ...handed].sort((a, b) => a.at.localeCompare(b.at));
}

function entry(item, data) {
  if (item.handoff) return handoffBubble(item.handoff, data);
  const { author, text } = item.message;
  return author === "owner" ? ownerBubble(text) : fromBubble("Agency", null, text);
}

// The worker whose turn it is, typing.
function typing(task, data) {
  const worker =
    task.status === "planning" ? "planner-decomposer" : task.plan?.steps[task.step]?.worker;
  if (!(task.status === "planning" || task.status === "running") || !worker) return null;
  const division = data.divisions?.[worker];
  const dots = el(
    "span",
    { class: "typing", "aria-label": `${data.roles[worker] ?? worker} is working` },
    el("span"),
    el("span"),
    el("span"),
  );
  return el(
    "li",
    { class: "from", style: divisionStyle(division) },
    mascot(division),
    el("div", { class: "bubble" }, dots),
  );
}

function button(label, onclick, kind = "primary") {
  return el("button", { type: "button", class: kind, onclick }, label);
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
  const steps = plan.steps.map((step) =>
    el(
      "li",
      {},
      el("strong", {}, roles[step.worker] ?? step.worker),
      `: ${step.goal}`,
      step.acceptance ? el("div", { class: "meta" }, `Done when: ${step.acceptance}`) : null,
    ),
  );
  return el(
    "li",
    { class: "card duo" },
    el("h2", {}, "Plan"),
    el("p", {}, plan.summary),
    el("ol", {}, steps),
    el("p", { class: "meta" }, estimateText(plan.estimate, task.budgetUsd)),
    el("div", { class: "actions" }, [
      button("Approve the plan", () => act(task.id, "approve")),
      button("Cancel", () => act(task.id, "cancel"), "secondary"),
      el("span", { class: "meta" }, "To change it, reply below."),
    ]),
  );
}

function decisionCard(task, act, openChanges) {
  const finished = task.plan && task.step >= task.plan.steps.length;
  const field = `budget-${task.id}`;
  const retryWithBudget = () =>
    act(task.id, "decide", { action: "retry", budgetUsd: Number(valueOf(field)) });
  const review = finished && task.changes?.length > 0;
  return el(
    "li",
    { class: "card duo" },
    el("h2", {}, finished ? "Every step passed" : "The agency needs a decision"),
    review ? el("p", { class: "meta" }, `Completing changes ${count(task.changes)}.`) : null,
    el("div", { class: "actions" }, [
      review ? button("Review the changes", openChanges, "secondary") : null,
      finished
        ? button("Complete the task", () => act(task.id, "decide", { action: "complete" }))
        : button("Try again", () => act(task.id, "decide", { action: "retry" })),
      button("Cancel the task", () => act(task.id, "decide", { action: "cancel" }), "secondary"),
    ]),
    el("label", { for: field }, "Or try again with a new budget in USD"),
    el("div", { class: "actions" }, [
      el("input", { id: field, type: "number", min: "0.01", step: "0.01", value: task.budgetUsd }),
      button("Try again with this budget", retryWithBudget, "secondary"),
    ]),
  );
}

// A task the agency is working on, or that waits paused, can be stopped from
// its header; tasks that wait on the owner have Cancel in their card.
const stoppable = new Set(["planning", "running", "paused"]);

function cancelButton(task, act) {
  if (!stoppable.has(task.status)) return null;
  const cancel = () => {
    const sure = globalThis.confirm(
      "Cancel this task? A call already in progress finishes and is paid for; nothing after it runs.",
    );
    if (sure) void act(task.id, "cancel");
  };
  return el(
    "button",
    { type: "button", class: "secondary danger", onclick: cancel },
    "Cancel task",
  );
}

export function threadHead(task, view, act) {
  const live = task.status === "running" || task.status === "planning";
  return el(
    "header",
    { class: "thread-head" },
    el("h1", {}, titleOf(task)),
    live ? el("span", { class: "live" }, "live") : null,
    el(
      "span",
      { class: "chip" },
      `${statusNames[task.status] ?? task.status} · ${usd(task.spentUsd)} of ${usd(task.budgetUsd)}`,
    ),
    el(
      "button",
      {
        type: "button",
        class: "secondary",
        "aria-expanded": String(view.panelOpen),
        onclick: view.togglePanel,
      },
      "Details",
    ),
    cancelButton(task, act),
  );
}

export function renderThread(task, data, act, openChanges) {
  return el(
    "ol",
    { class: "messages" },
    timeline(task).map((item) => entry(item, data)),
    typing(task, data),
    task.status === "awaiting_plan_approval" && task.plan ? planCard(task, data.roles, act) : null,
    task.status === "awaiting_decision" ? decisionCard(task, act, openChanges) : null,
  );
}
