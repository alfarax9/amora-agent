import { call } from "./api.js";
import { button, el } from "./dom.js";
import { openPicker } from "./projects.js";
import { go } from "./router.js";

// First run (app spec §15.1, the A1 part): what the agency still needs, step
// by step, each with the command that sets it up and, for the project, the
// picker. A project is optional: questions work without one. It finishes on
// Chat with the composer focused. The memory step comes with Memory (A2).

function step(gap) {
  return el(
    "li",
    {},
    el("p", {}, gap.problem),
    gap.fix === "project"
      ? el(
          "button",
          { type: "button", class: "secondary", onclick: () => void openPicker() },
          gap.command === "amora project --setup" ? "Set up the project" : "Choose a project",
        )
      : null,
    el("code", { class: "command" }, gap.command),
  );
}

function steps(readiness) {
  const needed = readiness.filter(({ fix }) => fix !== "project");
  const optional = readiness.filter(({ fix }) => fix === "project");
  if (readiness.length === 0) return el("p", {}, "Everything is set up.");
  const later = "Optional for now: questions are answered without a project.";
  return el(
    "section",
    { class: "box setup" },
    el("h2", {}, "Still to do"),
    el("ol", {}, needed.map(step)),
    optional.length ? el("p", { class: "meta" }, later) : null,
    el("ol", {}, optional.map(step)),
  );
}

export async function showSetup(container) {
  const { readiness } = await call("GET", "/api/tasks");
  const ready = readiness.every(({ fix }) => fix === "project");
  const finish = button("Start chatting", () => go("/"), "primary", {
    disabled: ready ? undefined : "",
  });
  container.replaceChildren(
    el(
      "div",
      { class: "page setup-page" },
      el("div", { class: "page-head" }, el("h1", {}, "Set up AMORA")),
      steps(readiness),
      el(
        "p",
        { class: "meta" },
        "Run the commands in a terminal; reload this page to check again.",
      ),
      el("div", { class: "actions" }, finish),
    ),
  );
}
