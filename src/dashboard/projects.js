import { el } from "./dom.js";

// The project a new task works on, picked under the composer the way Claude
// Code picks a session's environment: the projects added so far, the current
// one checked, and Add project, which opens the system's own folder dialog
// (Finder on a Mac) through the runtime.

const $ = (id) => document.getElementById(id);
const chip = $("project-chip");
const picker = $("project-picker");
let call;
let changed;

const nameOf = (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export function drawProjectChip(data, shown) {
  chip.hidden = !shown;
  const label = data.project ? nameOf(data.project) : "Choose a project";
  chip.replaceChildren(
    el("span", { "aria-hidden": "true" }, "▢"),
    label,
    el("span", { "aria-hidden": "true" }, "▾"),
  );
  chip.title = data.project ?? "No project yet";
}

async function choose(path) {
  await call("POST", "/api/projects/current", { path });
  picker.close();
  await changed();
}

let delivery = "branch";

// How a completed task reaches this project, as `amora delivery` decides.
function arrival(project) {
  if (project.git && delivery === "branch") return "Completed work arrives on a branch of its own";
  return "Completed files are copied in, with backups";
}

async function remove(project) {
  const reply = await call("POST", "/api/projects/remove", { path: project.path });
  renderPicker(reply.projects, "");
  await changed();
}

function projectItem(project) {
  const removeButton = el(
    "button",
    {
      type: "button",
      class: "remove",
      "aria-label": `Remove ${project.name} from the list`,
      title: "Remove from the list (the folder is not touched)",
      onclick: () => void remove(project),
    },
    "×",
  );
  return el("div", { class: "picker-row" }, projectChoice(project), removeButton);
}

function projectChoice(project) {
  const trouble = project.problems[0];
  const lacks = project.missingScripts.length
    ? `No ${project.missingScripts.join(", ")} script`
    : null;
  return el(
    "button",
    {
      type: "button",
      class: "picker-item",
      "aria-current": project.current ? "true" : undefined,
      disabled: trouble ? "" : undefined,
      onclick: () => choose(project.path),
    },
    el(
      "span",
      { class: "picker-name" },
      project.name,
      project.current ? el("span", { class: "check" }, " ✓") : null,
    ),
    el("span", { class: "meta" }, project.path),
    trouble || lacks ? el("span", { class: "warn" }, trouble ?? lacks) : null,
    !trouble ? el("span", { class: "meta" }, arrival(project)) : null,
  );
}

function renderPicker(projects, query) {
  const search = el("input", {
    id: "project-search",
    type: "search",
    placeholder: "Search projects",
    "aria-label": "Search projects",
    value: query,
  });
  const shown = projects.filter(({ name, path }) =>
    `${name} ${path}`.toLowerCase().includes(query.toLowerCase()),
  );
  search.addEventListener("input", () => {
    renderPicker(projects, search.value);
    $("project-search").focus();
  });
  picker.replaceChildren(
    el("h2", { id: "picker-title" }, "Project"),
    search,
    el(
      "div",
      { class: "picker-list" },
      shown.length
        ? shown.map(projectItem)
        : el(
            "p",
            { class: "meta" },
            projects.length
              ? "No project matches."
              : "No projects yet. Add the folder of an app AMORA should work on.",
          ),
    ),
    ...pickerFooter(),
  );
}

function pickerFooter() {
  return [
    el("p", { id: "picker-status", class: "meta", "aria-live": "polite" }),
    el("p", { id: "picker-error", class: "error", role: "alert" }),
    el(
      "div",
      { class: "picker-add" },
      el(
        "button",
        { id: "add-project", type: "button", class: "picker-item add", onclick: addFromSystem },
        "+ Add project",
      ),
    ),
  ];
}

// Add project opens the system's folder dialog; the folder picked there is
// added at once, or the page says why it cannot be a project.
async function addFromSystem() {
  const button = $("add-project");
  $("picker-error").textContent = "";
  $("picker-status").textContent = "Choose the project's folder in the window that just opened.";
  button.disabled = true;
  try {
    const reply = await call("POST", "/api/folders/choose");
    if (!reply.cancelled) {
      picker.close();
      await changed();
    }
  } catch (error) {
    $("picker-error").textContent =
      error.status === 501 ? `${error.message} Add one with: amora project <path>` : error.message;
  } finally {
    button.disabled = false;
    $("picker-status").textContent = "";
  }
}

export async function openPicker() {
  const reply = await call("GET", "/api/projects");
  const { projects } = reply;
  delivery = reply.delivery;
  renderPicker(projects, "");
  picker.showModal();
  $("project-search").focus();
}

// A click on the backdrop closes a dialog, as Escape does.
function closeOnBackdrop(element) {
  element.addEventListener("click", (event) => {
    if (event.target === element) element.close();
  });
}

export function initProjects(options) {
  ({ call, changed } = options);
  chip.addEventListener("click", () => void openPicker());
  closeOnBackdrop(picker);
}
