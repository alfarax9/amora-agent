import { el, usd } from "./dom.js";

// The handoff log of one task (PRD §6.2): who handed what to whom, whether it
// fit its contract, what the gate said, and which model actually answered.

const columns = [
  "From",
  "To",
  "Contract",
  "Validation",
  "Gate",
  "Model",
  "Answered by",
  "Attempt",
  "Cost",
];

export function handoffLog(task, roles) {
  if (task.handoffs.length === 0) return null;
  const name = (id) => (id === "owner" ? "You" : (roles[id] ?? id));
  const rows = task.handoffs.map((handoff) => {
    const gate = handoff.gateReason ? `${handoff.gate}: ${handoff.gateReason}` : handoff.gate;
    const cells = [
      name(handoff.sender),
      name(handoff.receiver),
      handoff.contract,
      handoff.validation,
      gate,
    ];
    cells.push(handoff.model, handoff.answeredBy, String(handoff.attempt), usd(handoff.costUsd));
    return el(
      "tr",
      {},
      cells.map((cell) => el("td", {}, cell)),
    );
  });
  const head = el(
    "tr",
    {},
    columns.map((label) => el("th", { scope: "col" }, label)),
  );
  // The log is wider than the panel; it scrolls on its own, not the page.
  return el(
    "div",
    { class: "scroll" },
    el("table", {}, el("thead", {}, head), el("tbody", {}, rows)),
  );
}
