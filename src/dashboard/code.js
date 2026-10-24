import { call } from "./api.js";
import { el } from "./dom.js";
import { drawProjectChip, openPicker } from "./projects.js";
import { renderThread, threadHead } from "./render.js";
import { go } from "./router.js";
import { setupNotice } from "./setup.js";

// Octa Code: a session with the agency's team on a project. /code starts one
// with the composer; /code/<id> is a session's thread, where the composer
// revises a plan that waits for approval and is closed while the team works.

const $ = (id) => document.getElementById(id);
const composer = $("composer");
const brief = $("brief");
let app;

export function startPage() {
  const { data } = app;
  const project = data.project ? `New sessions work on a copy of ${data.project}.` : null;
  return el(
    "div",
    { class: "start" },
    el("h1", {}, "What should the agency build?"),
    project ? el("p", { class: "meta" }, project) : null,
    setupNotice(data.readiness, () => void openPicker()),
  );
}

export function taskPage(task) {
  const { data, act, view } = app;
  const banner = data.paused
    ? el("p", { class: "banner" }, "All workers are paused. Resume them from the top bar.")
    : null;
  const openChanges = () => app.openTask(task.id, "changes");
  const thread = el("div", { class: "thread" }, banner, renderThread(task, data, act, openChanges));
  return [threadHead(task, view, act), thread];
}

const closedNotes = {
  planning: "The agency is on it…",
  running: "The agency is working on this task…",
  paused: "This task is paused.",
  awaiting_decision: "Decide above: complete, try again, or cancel.",
};

// A new task waits for the setup the runtime asks for; it would be refused.
// A question needs no project, so a missing project alone does not hold
// sending; the runtime refuses a task that needs one, and says why.
const blocked = () =>
  app.view.composer === "new" && (app.data?.readiness ?? []).some(({ fix }) => fix !== "project");

const noProject = () => (app.data?.readiness ?? []).some(({ fix }) => fix === "project");

function composerNote(mode) {
  if (mode === "revise") return "Your reply revises the plan.";
  if (mode !== "new") return "";
  if (blocked()) return "Sending opens once the setup above is done.";
  return noProject() ? "Questions are answered now; work needs a project." : "";
}

function readySend() {
  const ready = !brief.disabled && brief.value.trim() !== "" && !blocked();
  $("send").classList.toggle("ready", ready);
  $("send").disabled = !ready;
}

// The composer starts a session on /code, revises a plan that waits for
// approval, and is closed while the agency works or once a session ended.
export function placeComposer(task) {
  const { view, main, data } = app;
  const page = view.route.page;
  composer.hidden = !(page === "new" || (page === "task" && task));
  if (composer.hidden) return;
  (page === "new" ? main.querySelector(".start") : main).append(composer);
  const mode =
    page === "new" ? "new" : task.status === "awaiting_plan_approval" ? "revise" : "closed";
  view.composer = mode;
  brief.placeholder = {
    new: "Message the agency",
    revise: "Ask for changes to the plan",
    closed:
      closedNotes[task?.status] ?? "This session has ended. Start a new one with New session.",
  }[mode];
  brief.disabled = mode === "closed";
  drawProjectChip(data, mode === "new");
  $("budget-field").hidden = mode !== "new";
  $("composer-note").textContent = composerNote(mode);
  readySend();
}

async function submit() {
  const { view } = app;
  $("composer-error").textContent = "";
  const text = brief.value.trim();
  if (text === "" || view.composer === "closed") return;
  try {
    if (view.composer === "revise") {
      await call("POST", `/api/tasks/${view.route.id}/revise`, { feedback: text });
    } else {
      const budgetUsd = Number($("budget").value);
      const { task } = await call("POST", "/api/tasks", { brief: text, budgetUsd });
      go(`/code/${task.id}`);
    }
    brief.value = "";
    brief.style.height = "";
  } catch (error) {
    $("composer-error").textContent = error.message;
  }
  await app.refresh();
}

// `context` is the app's: its view, the latest data, act, refresh, and main.
export function initCode(context) {
  app = context;
  // Enter sends and Shift+Enter starts a new line, as in a chat.
  brief.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  brief.addEventListener("input", () => {
    brief.style.height = "auto";
    brief.style.height = `${brief.scrollHeight}px`;
    readySend();
  });
  $("send").addEventListener("click", () => void submit());
}
