import { taskCard } from "./cards.js";
import { button, el } from "./dom.js";
import { markdown } from "./markdown.js";
import { mascot } from "./render.js";

// How a chat reads (app spec §8.4): the owner's messages as blocks, each
// worker's reply flat under its division's mark with who answered and on
// which brain, a task as its card, and every version one click away.

const named = (division) => (division ? division[0].toUpperCase() + division.slice(1) : "");

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// Suggestions name work the installed workers really do; a division that is
// not installed is never offered.
const suggestions = {
  nexus: "Explain how this agency plans a task",
  compass: "Write the requirements for a sign-in feature",
  atelier: "Design an empty state for a task list",
  forge: "Build a pricing section for my landing page",
  crucible: "Write tests for a cart total function",
};

export function homeView(data, use) {
  const installed = new Set(Object.values(data?.divisions ?? {}));
  const chips = Object.entries(suggestions)
    .filter(([division]) => installed.has(division))
    .map(([division, text]) =>
      el(
        "button",
        { type: "button", class: "chip suggestion", onclick: () => use(text) },
        el("span", { class: "dot", style: `--division: var(--division-${division})` }),
        text,
      ),
    );
  return el(
    "div",
    { class: "start chat-start" },
    el("h1", {}, greeting()),
    el(
      "p",
      { class: "meta" },
      "Ask the agency a question, or give it work: it plans before anything runs.",
    ),
    chips.length ? el("div", { class: "suggestions" }, chips) : null,
  );
}

export function brainText(brain) {
  if (!brain || "problem" in brain) return ["No brain yet", brain?.problem ?? ""];
  return [
    `brain: ${brain.role} (${brain.label})`,
    `${brain.model}, ${brain.family ?? "family unknown"}`,
  ];
}

function versions(message, show) {
  if (message.versions.length < 2) return null;
  const at = message.version - 1;
  const step = (by) => () => show(message.versions[at + by]);
  return el(
    "span",
    { class: "versions", "aria-label": `Version ${message.version} of ${message.versions.length}` },
    el(
      "button",
      {
        type: "button",
        class: "ghost",
        "aria-label": "Previous version",
        disabled: at === 0 ? "" : undefined,
        onclick: step(-1),
      },
      "‹",
    ),
    `${message.version}/${message.versions.length}`,
    el(
      "button",
      {
        type: "button",
        class: "ghost",
        "aria-label": "Next version",
        disabled: at === message.versions.length - 1 ? "" : undefined,
        onclick: step(1),
      },
      "›",
    ),
  );
}

function copyButton(text) {
  const button = el("button", { type: "button", class: "ghost" }, "Copy");
  button.addEventListener("click", async () => {
    await globalThis.navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  });
  return button;
}

function editor(message, on) {
  const field = el("textarea", { rows: "3", "aria-label": "Edit your message" }, message.text);
  const save = () => field.value.trim() && on.edit(message, field.value.trim());
  return el(
    "div",
    { class: "user-block editing" },
    field,
    el(
      "div",
      { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: save }, "Send"),
      el("button", { type: "button", class: "secondary", onclick: () => on.redraw() }, "Cancel"),
    ),
  );
}

function userMessage(message, on, editing) {
  if (editing === message.id) return el("li", { class: "you" }, editor(message, on));
  return el(
    "li",
    { class: "you" },
    el("div", { class: "user-block" }, el("p", {}, message.text)),
    el(
      "div",
      { class: "message-actions" },
      versions(message, on.show),
      el(
        "button",
        { type: "button", class: "ghost", onclick: () => on.startEdit(message.id) },
        "Edit",
      ),
      copyButton(message.text),
    ),
  );
}

// The brain's label is known for the worker answering now; an older reply
// shows its model only.
function labelOf(worker, brain) {
  if (!brain || "problem" in brain || brain.worker !== worker) return "";
  return ` (${brain.label})`;
}

function workerHead(worker, model, view) {
  const roles = view.data?.roles ?? {};
  const division = view.data?.divisions?.[worker] ?? "nexus";
  return el(
    "p",
    { class: "worker-head", style: `--division: var(--division-${division})` },
    el("strong", {}, roles[worker] ?? worker ?? "AMORA"),
    el("span", { class: "division-name" }, named(division)),
    model ? el("span", { class: "meta" }, `${model}${labelOf(worker, view.brain)}`) : null,
  );
}

function replyActions(message, on) {
  if (message.failed) {
    return [
      el("p", { class: "error" }, message.failed),
      button("Retry", () => on.retry(), "secondary"),
    ];
  }
  if (message.streaming) return [];
  return [
    versions(message, on.show),
    copyButton(message.text),
    button("Retry", () => on.retry(message.id)),
    message.status === "stopped" ? el("span", { class: "meta" }, "Stopped") : null,
  ];
}

const writing = () =>
  el("span", { class: "typing", "aria-label": "Writing" }, el("span"), el("span"), el("span"));

export function reply(message, view, on) {
  const division = view.data?.divisions?.[message.worker] ?? "nexus";
  const body = message.text ? markdown(message.text, { onSave: on.saveCode }) : [writing()];
  return el(
    "li",
    { class: "reply" },
    mascot(division),
    el(
      "div",
      { class: "reply-body" },
      workerHead(message.worker, message.model, view),
      el("div", { class: "prose" }, body),
      el("div", { class: "message-actions" }, replyActions(message, on)),
    ),
  );
}

export function messageView(message, view, on) {
  if (message.kind === "card") return taskCard(message.taskId, view.data, on.act);
  return message.role === "user"
    ? userMessage(message, on, view.editing)
    : reply(message, view, on);
}

export function threadHead(chat, on) {
  return el(
    "header",
    { class: "thread-head" },
    el(
      "button",
      { type: "button", class: "title-button", title: "Rename", onclick: on.rename },
      el("h1", {}, chat.title),
    ),
    el("span", { class: "chip target-chip", title: "Who answers in this chat" }, "@ Agency"),
    el(
      "button",
      { type: "button", class: "ghost", "aria-pressed": String(chat.starred), onclick: on.star },
      chat.starred ? "★ Starred" : "☆ Star",
    ),
    el("button", { type: "button", class: "ghost", onclick: on.exportChat }, "Export"),
    el("button", { type: "button", class: "ghost", onclick: on.remove }, "Delete"),
  );
}
