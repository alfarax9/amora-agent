import { el, usd } from "./dom.js";
import { divisionStyle } from "./render.js";

// Costs: spend per day, per worker, and per model over the last 30 days, and
// what a completed task cost. Amounts are what the gateway reported for each
// call; where it reported none, an estimate from tokens and price is shown and
// called an estimate.

const tokens = (count) =>
  count >= 1e6
    ? `${(count / 1e6).toFixed(1)}M`
    : count >= 1e3
      ? `${Math.round(count / 1e3)}k`
      : String(count);

function stat(label, value, detail) {
  return el(
    "div",
    { class: "stat" },
    el("dt", {}, label),
    el("dd", {}, value, detail ? el("small", {}, detail) : null),
  );
}

function summary(report) {
  const total = report.days.reduce((sum, day) => sum + day.usd, 0);
  const { perTask } = report;
  const average = perTask.averageUsd === null ? "—" : usd(perTask.averageUsd);
  const planned =
    perTask.estimatedAverageUsd === null
      ? ""
      : `; plans estimated ${usd(perTask.estimatedAverageUsd)} (estimate)`;
  const all = perTask.allSpendPerCompletedUsd === null ? "—" : usd(perTask.allSpendPerCompletedUsd);
  return el(
    "dl",
    { class: "cards" },
    stat(`Spent, last ${report.windowDays} days`, usd(total), `${perTask.tasks} tasks`),
    stat("Cost per completed task", average, `${perTask.completed} completed${planned}`),
    stat("All spend per completed task", all, "failed and cancelled tasks included"),
  );
}

function table(names, rows, empty) {
  if (rows.length === 0) return el("p", { class: "empty-note" }, empty);
  const head = el(
    "tr",
    {},
    names.map(([name, kind]) => el("th", { class: kind }, name)),
  );
  return el(
    "div",
    { class: "scroll" },
    el("table", {}, el("thead", {}, head), el("tbody", {}, rows)),
  );
}

function dayRow(day, report, most) {
  const over = report.dailyUsd !== null && day.usd > report.dailyUsd;
  const width = most > 0 ? Math.round((day.usd / most) * 100) : 0;
  return el(
    "tr",
    {},
    el("td", {}, new Date(`${day.day}T00:00`).toLocaleDateString()),
    el("td", { class: "right" }, String(day.handoffs)),
    el(
      "td",
      { class: "wide-only" },
      el(
        "span",
        { class: over ? "bar wide over" : "bar wide" },
        el("span", { style: `width: ${width}%` }),
      ),
    ),
    el(
      "td",
      { class: over ? "right failed" : "right" },
      usd(day.usd),
      over ? " over the daily limit" : "",
    ),
  );
}

function perDay(report) {
  const most = Math.max(0, ...report.days.map((day) => day.usd));
  const limit =
    report.dailyUsd === null ? "No daily limit is set." : `Daily limit ${usd(report.dailyUsd)}.`;
  return el(
    "section",
    { class: "box" },
    el("h2", {}, "Per day"),
    table(
      [["Day"], ["Handoffs", "right"], ["", "wide-only"], ["Spent", "right"]],
      report.days.map((day) => dayRow(day, report, most)),
      "Nothing was spent in this window.",
    ),
    el("p", { class: "meta" }, limit),
  );
}

function perWorker(report, data) {
  const rows = report.workers.map((row) =>
    el(
      "tr",
      { style: divisionStyle(data.divisions?.[row.worker]) },
      el(
        "td",
        {},
        el(
          "span",
          { class: "worker" },
          el("span", { class: "dot" }),
          data.roles[row.worker] ?? row.worker,
        ),
      ),
      el("td", { class: "right" }, String(row.handoffs)),
      el(
        "td",
        { class: "right wide-only" },
        `${tokens(row.tokensIn)} in, ${tokens(row.tokensOut)} out`,
      ),
      el("td", { class: "right" }, usd(row.usd)),
    ),
  );
  return el(
    "section",
    { class: "box" },
    el("h2", {}, "Per worker"),
    table(
      [["Worker"], ["Handoffs", "right"], ["Tokens", "right wide-only"], ["Spent", "right"]],
      rows,
      "No worker has worked in this window.",
    ),
  );
}

function estimate(row) {
  if (row.unreported === 0) return "—";
  const calls = row.unreported === 1 ? "1 call" : `${row.unreported} calls`;
  if (row.estimatedUsd === null) return `${calls} with no cost reported and no price known`;
  return `${usd(row.estimatedUsd)} estimate for ${calls} with no cost reported`;
}

function perModel(report) {
  const rows = report.models.map((row) =>
    el(
      "tr",
      {},
      el("td", {}, el("code", {}, row.model)),
      el("td", { class: "right" }, String(row.handoffs)),
      el(
        "td",
        { class: "right wide-only" },
        `${tokens(row.tokensIn)} in, ${tokens(row.tokensOut)} out`,
      ),
      el("td", { class: "right" }, usd(row.usd)),
      el("td", { class: row.unreported > 0 ? "waiting" : "" }, estimate(row)),
    ),
  );
  return el(
    "section",
    { class: "box" },
    el("h2", {}, "Per model"),
    table(
      [
        ["Model"],
        ["Handoffs", "right"],
        ["Tokens", "right wide-only"],
        ["Reported", "right"],
        ["Estimate"],
      ],
      rows,
      "No model answered in this window.",
    ),
    el(
      "p",
      { class: "meta" },
      "Reported is what the gateway billed. A gateway that reports no cost, such as OmniRoute, leaves calls at $0; their estimate uses the model's price, a combo's dearest member's.",
    ),
  );
}

export function renderCosts(report, data) {
  return [summary(report), perDay(report), perWorker(report, data), perModel(report)];
}
