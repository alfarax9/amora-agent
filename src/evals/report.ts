import type { EvalRow, System } from "./run.ts";

// The headline is cost per successful task (PRD §3, §7.7), next to the success
// rate overall and on held-out briefs only.

export type Summary = {
  system: System;
  tasks: number;
  successes: number;
  heldOutTasks: number;
  heldOutSuccesses: number;
  calls: number;
  tokens: number;
  costUsd: number;
  seconds: number;
  costPerSuccessUsd: number | null;
  tokensPerSuccess: number | null;
};

const sum = (rows: EvalRow[], pick: (row: EvalRow) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

export function summarize(rows: EvalRow[]): Summary[] {
  const systems = [...new Set(rows.map(({ system }) => system))];
  return systems.map((system) => {
    const own = rows.filter((row) => row.system === system);
    const heldOut = own.filter((row) => row.heldOut);
    const successes = own.filter((row) => row.success).length;
    const costUsd = sum(own, (row) => row.costUsd);
    const tokens = sum(own, (row) => row.tokensIn + row.tokensOut);
    return {
      system,
      tasks: own.length,
      successes,
      heldOutTasks: heldOut.length,
      heldOutSuccesses: heldOut.filter((row) => row.success).length,
      calls: sum(own, (row) => row.calls),
      tokens,
      costUsd,
      seconds: sum(own, (row) => row.seconds),
      costPerSuccessUsd: successes > 0 ? costUsd / successes : null,
      tokensPerSuccess: successes > 0 ? Math.round(tokens / successes) : null,
    };
  });
}

const usd = (amount: number | null) => (amount === null ? "n/a" : `$${amount.toFixed(4)}`);
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);

export function markdownReport(rows: EvalRow[], summaries: Summary[], title: string): string {
  const head = [
    `# ${title}`,
    "",
    "| System | Successes | Held out | Calls | Tokens | Cost | Cost per success | Tokens per success | Time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summaries.map(
      (s) =>
        `| ${s.system} | ${s.successes} of ${s.tasks} | ${s.heldOutSuccesses} of ${s.heldOutTasks} | ${s.calls} | ${s.tokens} | ${usd(s.costUsd)} | ${usd(s.costPerSuccessUsd)} | ${s.tokensPerSuccess ?? "n/a"} | ${s.seconds} s |`,
    ),
    "",
    "| Brief | Held out | System | Success | Hidden tests | Calls | Tokens | Time | Why |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const lines = rows.map(
    (r) =>
      `| ${r.brief} | ${r.heldOut ? "yes" : "no"} | ${r.system} | ${r.success ? "yes" : "no"} | ${r.passed} passed, ${r.failed} failed | ${r.calls} | ${r.tokensIn + r.tokensOut} | ${r.seconds} s | ${cell(r.reason)} |`,
  );
  return `${[...head, ...lines].join("\n")}\n`;
}
