import { el, usd } from "./dom.js";
import { divisionStyle, mascot } from "./render.js";

// Workers: the roster by division under its mascot. Each worker shows the
// model its slot resolves to and from which level, its requirements checked
// against that model, and its latest handoffs with what the gate said.

// PRD §7.4. Evals arrive later, so a model that fits is Experimental.
const verdicts = {
  fits: ["Experimental", "passed"],
  unprobed: ["Unverified", "waiting"],
  rejected: ["Rejected", "failed"],
  unassigned: ["No model", "waiting"],
};

const levels = { global: "global default", division: "division default", worker: "its own" };

const gates = {
  passed: ["Passed", "passed"],
  failed: ["Gate failed", "failed"],
  blocked: ["Blocked", "waiting"],
  none: ["No gate", ""],
};

function check({ code, name, met, detail }) {
  const [mark, kind, state] =
    met === true
      ? ["✓", "passed", "met"]
      : met === false
        ? ["✗", "failed", "not met"]
        : ["?", "", "not known yet"];
  const title = `${name}: ${state}${detail ? `. ${detail}` : ""}`;
  return el("li", { class: `check ${kind}`, title }, `${code} ${mark}`);
}

function handoffLine(handoff) {
  const [gate, kind] = gates[handoff.gate] ?? [handoff.gate, ""];
  const reason = handoff.gateReason ? `: ${handoff.gateReason}` : "";
  return el(
    "li",
    {},
    el("span", { class: kind }, `${gate}${reason}`),
    " · ",
    el("a", { href: `/code/${handoff.taskId}` }, handoff.task),
    el(
      "span",
      { class: "meta" },
      ` · attempt ${handoff.attempt} · ${handoff.validation} · ${handoff.model} · ${usd(handoff.costUsd)} · ${new Date(handoff.createdAt).toLocaleString()}`,
    ),
  );
}

function modelLine(worker) {
  const [label, kind] = verdicts[worker.verdict] ?? [worker.verdict, ""];
  const model = worker.model
    ? [el("code", {}, worker.model), el("span", { class: "meta" }, ` ${levels[worker.level]}`)]
    : el("span", { class: "meta" }, "No model is assigned.");
  return el("p", { class: "worker-model" }, model, el("span", { class: `chip ${kind}` }, label));
}

function workerCard(worker) {
  const handoffs =
    worker.handoffs.length > 0
      ? el("ul", { class: "handoffs" }, worker.handoffs.map(handoffLine))
      : el("p", { class: "meta" }, "No handoffs yet.");
  return el(
    "article",
    { class: "worker-card" },
    el(
      "header",
      {},
      el("span", { class: "worker" }, el("span", { class: "dot" }), worker.role),
      el("span", { class: "chip" }, `Wave ${worker.wave}`),
    ),
    el("p", { class: "meta" }, worker.id, " · ", worker.mission),
    modelLine(worker),
    worker.checks.length > 0
      ? el("ul", { class: "checks", "aria-label": "Requirements" }, worker.checks.map(check))
      : null,
    worker.problems.map((problem) => el("p", { class: "failed small" }, problem)),
    el("h3", {}, "Recent handoffs"),
    handoffs,
  );
}

function divisionBox({ division, workers }) {
  const name = division[0].toUpperCase() + division.slice(1);
  const count = workers.length === 1 ? "1 worker" : `${workers.length} workers`;
  return el(
    "section",
    { class: "box", style: divisionStyle(division) },
    el(
      "h2",
      { class: "division-head" },
      mascot(division),
      el("span", { class: "division-name" }, name),
      el("span", { class: "meta" }, count),
    ),
    el("div", { class: "worker-grid" }, workers.map(workerCard)),
  );
}

export function renderWorkers(report) {
  if (report.divisions.length === 0) {
    return [el("p", { class: "empty-note" }, "No worker manifests are loaded.")];
  }
  return [
    el(
      "p",
      { class: "meta" },
      "A slot resolves to the worker's own model, then its division's, then the global default. Hover a requirement for what it checks. Assign models with amora models set.",
    ),
    report.divisions.map(divisionBox),
  ];
}
