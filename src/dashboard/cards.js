import { el, usd } from "./dom.js";
import { mascot } from "./render.js";
import { statusMark } from "./status.js";

// The cards a task shows in the chat that started it (app spec §8.5). A card
// is a view of the task record from /api/tasks, never the record itself: the
// same task opens in Octa Code. One card follows the task through its life:
// a question, a plan to approve, progress with each gate, a decision, and the
// delivery. Mod+Enter on a focused card takes its first action.

const button = (label, onclick, kind = "primary") =>
  el("button", { type: "button", class: kind, onclick }, label);

const roleOf = (data, id) => data.roles?.[id] ?? id;

function frame(task, title, body, actions) {
  const heading = `card-${task.id}`;
  const card = el(
    "section",
    { class: "agency-card", role: "region", "aria-labelledby": heading, tabindex: "0" },
    el("h3", { id: heading }, title),
    ...body,
    actions.length ? el("div", { class: "actions" }, actions) : null,
  );
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      card.querySelector(".actions button")?.click();
    }
  });
  return card;
}

function clarification(task, act) {
  const question = task.plan.question;
  const field = el("input", {
    type: "text",
    "aria-label": "Your answer",
    placeholder: "Or write your answer",
  });
  const answer = (text) => text.trim() && act(task.id, "revise", { feedback: text.trim() });
  const choices = question.choices.map((choice) =>
    button(choice, () => answer(choice), "secondary"),
  );
  return frame(
    task,
    "The Planner asks",
    [el("p", {}, question.text), el("div", { class: "actions" }, choices), field],
    [button("Answer", () => answer(field.value))],
  );
}

// Steps grouped by division, each with the worker that owns it.
function stepsByDivision(task, data) {
  const groups = new Map();
  for (const step of task.plan.steps) {
    const division = data.divisions?.[step.worker] ?? "agency";
    groups.set(division, [...(groups.get(division) ?? []), step]);
  }
  return [...groups].map(([division, steps]) =>
    el(
      "div",
      { class: "division-steps", style: `--division: var(--division-${division})` },
      el("p", { class: "division-name" }, division[0].toUpperCase() + division.slice(1)),
      el(
        "ol",
        {},
        steps.map((step) =>
          el("li", {}, el("strong", {}, roleOf(data, step.worker)), `: ${step.goal}`),
        ),
      ),
    ),
  );
}

function planCard(task, data, act) {
  const estimate = task.plan.estimate;
  const cost = estimate?.unpriced?.length
    ? `No price is known for ${estimate.unpriced.join(", ")}.`
    : `Estimated ${usd(estimate?.usd ?? 0)} (an estimate), within a budget of ${usd(task.budgetUsd)}.`;
  const change = el("textarea", {
    rows: "2",
    "aria-label": "What to change in the plan",
    placeholder: "What should change?",
  });
  const edit = () =>
    change.value.trim() && act(task.id, "revise", { feedback: change.value.trim() });
  return frame(
    task,
    "Plan",
    [
      el("p", {}, task.plan.summary),
      ...stepsByDivision(task, data),
      el("p", { class: "meta" }, "Each step passes its quality gate before the next one starts."),
      el("p", { class: "meta" }, cost),
      el(
        "details",
        {},
        el("summary", {}, "Edit plan"),
        change,
        button("Ask for this change", edit, "secondary"),
      ),
    ],
    [
      button("Approve and start", () => act(task.id, "approve")),
      button("Cancel", () => act(task.id, "cancel"), "secondary"),
    ],
  );
}

const gateShapes = {
  passed: ["done", "Passed"],
  failed: ["blocked", "Failed"],
  blocked: ["approval", "Blocked"],
};

// A gate's reason can hold a whole test run; the card shows its first line,
// and Octa Code the rest.
function firstLine(text) {
  const line = text.split("\n")[0] ?? "";
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

// Each gate a step reached: passed or failed, by whom, and which attempt.
function gates(task, data) {
  const reached = task.handoffs.filter(({ gate, sender }) => gate !== "none" && sender !== "owner");
  if (reached.length === 0) return [];
  return [
    el(
      "ul",
      { class: "gate-list" },
      reached.map((handoff) => {
        const [shape, label] = gateShapes[handoff.gate] ?? ["idle", handoff.gate];
        const reason = handoff.gateReason ? ` · ${firstLine(handoff.gateReason)}` : "";
        return el(
          "li",
          {},
          statusMark(shape, label),
          el("span", {}, `${roleOf(data, handoff.sender)}, attempt ${handoff.attempt}/3${reason}`),
        );
      }),
    ),
  ];
}

function progressCard(task, data) {
  const steps = task.plan?.steps ?? [];
  const now = steps[task.step];
  const line = now
    ? `Step ${task.step + 1} of ${steps.length}: ${roleOf(data, now.worker)} · ${usd(task.spentUsd)} spent`
    : `The Planner is drafting a plan · ${usd(task.spentUsd)} spent`;
  const shape = task.status === "paused" ? ["paused", "Paused"] : ["running", "Working"];
  return frame(
    task,
    "Progress",
    [el("p", { class: "progress-line" }, statusMark(...shape), line), ...gates(task, data)],
    [el("a", { class: "secondary", href: `/code/${task.id}` }, "Open task")],
  );
}

function decisionCard(task, data, act) {
  const finished = task.plan && task.step >= task.plan.steps.length;
  return frame(
    task,
    finished ? "Every step passed" : "A gate needs your decision",
    [el("p", {}, task.reason ?? ""), ...gates(task, data)],
    [
      finished
        ? button("Complete the task", () => act(task.id, "decide", { action: "complete" }))
        : button("Try again", () => act(task.id, "decide", { action: "retry" })),
      el("a", { class: "secondary", href: `/code/${task.id}` }, "Review in Octa Code"),
      button("Cancel the task", () => act(task.id, "decide", { action: "cancel" }), "secondary"),
    ],
  );
}

function minutes(task) {
  const spent = (Date.parse(task.updatedAt) - Date.parse(task.createdAt)) / 60_000;
  return spent < 1 ? "under a minute" : `${Math.round(spent)} min`;
}

function deliveryCard(task, data) {
  const files = task.handoffs.flatMap(({ artifacts }) => artifacts ?? []);
  const changed = files.length === 1 ? "1 file changed" : `${files.length} files changed`;
  return frame(
    task,
    "Delivered",
    [
      el("p", {}, task.plan?.summary ?? task.brief),
      el("p", { class: "meta" }, `${changed} · ${usd(task.spentUsd)} · ${minutes(task)}`),
      ...gates(task, data),
    ],
    [el("a", { class: "primary", href: `/code/${task.id}` }, "Open in Octa Code")],
  );
}

function endedCard(task) {
  const title = task.status === "cancelled" ? "Cancelled" : "Stopped";
  return frame(task, title, [el("p", { class: "meta" }, task.reason ?? "")], []);
}

function cardFor(task, data, act) {
  if (task.status === "awaiting_plan_approval" && task.plan?.question)
    return clarification(task, act);
  if (task.status === "awaiting_plan_approval" && task.plan) return planCard(task, data, act);
  if (task.status === "awaiting_decision") return decisionCard(task, data, act);
  if (task.status === "completed") return deliveryCard(task, data);
  if (task.status === "failed" || task.status === "cancelled") return endedCard(task);
  return progressCard(task, data);
}

// The card a chat message stands for, under the Planner's mark.
export function taskCard(taskId, data, act) {
  const task = data?.tasks.find(({ id }) => id === taskId);
  const body = task
    ? cardFor(task, data, act)
    : el("p", { class: "meta" }, "This task is no longer among the recent ones.");
  return el("li", { class: "reply" }, mascot("nexus"), el("div", { class: "reply-body" }, body));
}
