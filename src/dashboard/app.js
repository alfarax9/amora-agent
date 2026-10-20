import { el, usd } from "./dom.js";
import { renderThread } from "./render.js";

// The agency chat: polls the runtime every two seconds and re-renders only
// when something changed, keeping whatever the owner is typing.

const threads = document.getElementById("threads");
const meter = document.getElementById("budget-meter");
const pause = document.getElementById("pause");
const actionError = document.getElementById("action-error");
const composerError = document.getElementById("composer-error");
let shown = "";
let paused = false;

async function call(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("The runtime is not answering. Is amora still running?");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The runtime could not do that. Check its log.");
  return data;
}

// A re-render replaces the fields and logs, so what the owner typed, which
// field had focus, and which logs were open are carried over.
function keepFields(render) {
  const fields = [...threads.querySelectorAll("textarea, input")];
  const values = new Map(fields.map((field) => [field.id, field.value]));
  const open = [...threads.querySelectorAll("details[open]")].map((log) => log.id);
  const focused = document.activeElement?.id;
  render();
  for (const [id, value] of values) {
    const field = document.getElementById(id);
    if (field) field.value = value;
  }
  for (const id of open) document.getElementById(id)?.setAttribute("open", "");
  if (focused) document.getElementById(focused)?.focus();
}

function show(data) {
  const snapshot = JSON.stringify(data);
  if (snapshot === shown) return;
  shown = snapshot;
  paused = data.paused;
  const spent = `Spent today ${usd(data.spentTodayUsd)}`;
  const budget =
    data.dailyUsd === null
      ? `${spent}. No daily limit yet: run amora budget --daily <usd> before approving a task.`
      : `${spent} of ${usd(data.dailyUsd)}.`;
  const project = data.project
    ? `New tasks work on a copy of ${data.project}.`
    : "No project folder yet: run amora project <path> so workers can write code.";
  meter.textContent = `${budget} ${project}`;
  pause.hidden = false;
  pause.textContent = paused ? "Resume" : "Pause all workers";
  const empty = el("p", { class: "meta" }, "No tasks yet. Describe what to build below.");
  const items = data.tasks.map((task) => renderThread(task, data.roles, act));
  keepFields(() => threads.replaceChildren(...(items.length > 0 ? items : [empty])));
}

async function refresh() {
  try {
    show(await call("GET", "/api/tasks"));
  } catch (error) {
    actionError.textContent = error.message;
  }
}

// Says whether the runtime accepted the action, so a form can clear itself.
async function act(id, action, body = {}) {
  actionError.textContent = "";
  let accepted = true;
  try {
    await call("POST", `/api/tasks/${id}/${action}`, body);
  } catch (error) {
    actionError.textContent = error.message;
    accepted = false;
  }
  await refresh();
  return accepted;
}

pause.addEventListener("click", async () => {
  actionError.textContent = "";
  try {
    show(await call("POST", paused ? "/api/resume" : "/api/pause"));
  } catch (error) {
    actionError.textContent = error.message;
  }
});

document.getElementById("send").addEventListener("click", async () => {
  composerError.textContent = "";
  const brief = document.getElementById("brief");
  const budgetUsd = Number(document.getElementById("budget").value);
  try {
    await call("POST", "/api/tasks", { brief: brief.value, budgetUsd });
    brief.value = "";
  } catch (error) {
    composerError.textContent = error.message;
  }
  await refresh();
});

void refresh();
setInterval(refresh, 2000);
