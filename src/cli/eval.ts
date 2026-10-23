import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markdownReport, summarize } from "../evals/report.ts";
import { type EvalRow, runSuite, type System } from "../evals/run.ts";
import { loadSuite } from "../evals/suite.ts";
import type { Agency } from "../runtime/agency.ts";
import { createLogger } from "../runtime/logger.ts";
import { dataDirectory } from "../runtime/storage.ts";
import { agencyFor } from "./agency.ts";
import { type AppContext, packageRoot } from "./context.ts";
import { print, printError } from "./output.ts";

// `amora eval` (PRD §3, §7.6): runs the benchmark set through AMORA's thin path
// and through one strong agent on the same model, and reports success, cost,
// and cost per successful task. Every brief calls the owner's models.

export type EvalOptions = {
  briefs: string[];
  system: string;
  baselineModel: string | undefined;
  budgetUsd: number;
  runs: number;
  tier: string;
};

const systemNames: System[] = ["full", "small", "auto", "best-of-2", "single-agent"];
const systemAliases: Record<string, string> = {
  all: "full,small,single-agent",
  both: "full,single-agent",
};

// A shorthand or a comma-separated list such as small,single-agent; an unknown or
// repeated name refuses the whole list.
function systemsOf(option: string): System[] | undefined {
  const listed = (systemAliases[option] ?? option).split(",");
  const systems = systemNames.filter((name) => listed.includes(name));
  return systems.length === listed.length ? systems : undefined;
}

function describeRow(row: EvalRow): string {
  const verdict = row.success ? "success" : "no success";
  return `${row.brief} (${row.system}, run ${row.run}): ${verdict}; hidden tests ${row.passed} passed, ${row.failed} failed; ${row.calls} calls, ${row.seconds} s. ${row.reason}`;
}

// Everything that would make a run spend quota for nothing is refused first.
function preflight(context: AppContext, options: EvalOptions, systems: System[] | undefined) {
  if (!systems) {
    return "--system must be all, both, or a comma-separated list of full, small, auto, best-of-2, and single-agent.";
  }
  const baselineModel = options.baselineModel ?? context.slots.global;
  if (systems.includes("single-agent") && !baselineModel) {
    return "Name the single agent's model with --single-agent-model, or set a global model.";
  }
  const daily = context.storage.getSetting<{ dailyUsd: number }>("budgets")?.dailyUsd;
  if (systems.some((system) => system !== "single-agent") && daily === undefined) {
    return "AMORA's tasks need a daily limit first: amora budget --daily <usd>";
  }
  return undefined;
}

function selected(ids: string[], tier: string) {
  if (!["all", "regression", "realistic", "heavy"].includes(tier)) {
    return { problem: "--tier must be all, regression, realistic, or heavy." };
  }
  const { items: all, errors } = loadSuite(join(packageRoot, "evals"));
  if (errors.length > 0) return { problem: errors.join("\n") };
  const items = all.filter((brief) => tier === "all" || brief.tier === tier);
  const unknown = ids.filter((id) => !items.some((brief) => brief.id === id));
  if (unknown.length > 0) {
    return {
      problem: `No brief is named ${unknown.join(", ")}. Briefs: ${items.map(({ id }) => id).join(", ")}`,
    };
  }
  return { briefs: ids.length === 0 ? items : items.filter(({ id }) => ids.includes(id)) };
}

function writeReport(out: string, rows: EvalRow[], stopped: string | undefined): void {
  const summaries = summarize(rows);
  const report = { summaries, rows, ...(stopped ? { stopped } : {}) };
  writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const note = stopped ? `\nStopped early, not scored: ${stopped}\n` : "";
  writeFileSync(join(out, "report.md"), markdownReport(rows, summaries, "AMORA benchmark") + note);
  for (const s of summaries) {
    const perSuccess = s.costPerSuccessUsd === null ? "n/a" : `$${s.costPerSuccessUsd.toFixed(4)}`;
    print(
      `${s.system}: ${s.successes} of ${s.tasks} succeeded (${s.heldOutSuccesses} of ${s.heldOutTasks} held out; ${s.steadyBriefs} of ${s.briefs} briefs in every run); ${s.calls} calls, ${s.tokens} tokens, cost per success ${perSuccess}`,
    );
  }
  print(`Report: ${join(out, "report.md")}`);
  if (stopped) {
    printError(
      `Stopped: a provider could not serve ${stopped}. That brief is not scored for any system; the report covers the briefs finished before it. Run again once the provider is back.`,
    );
  }
}

export async function runEval(context: AppContext, options: EvalOptions): Promise<boolean> {
  const systems = systemsOf(options.system);
  const problem = preflight(context, options, systems);
  const suite = selected(options.briefs, options.tier);
  if (problem || "problem" in suite) return (printError(problem ?? suite.problem ?? ""), false);
  const contract = context.contracts.find(({ id }) => id === "code_change.v1");
  if (!contract || !systems) return (printError("The code_change.v1 contract is missing."), false);
  const out = join(dataDirectory(), "evals", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  print(
    `Running ${suite.briefs.length} briefs through ${systems.join(" and ")}, ${options.runs === 1 ? "once" : `${options.runs} times`}. This calls your models.`,
  );
  const agency: Agency = agencyFor(context);
  const { rows, stopped } = await runSuite(
    {
      agency,
      baselineModel: options.baselineModel ?? context.slots.global ?? "",
      baselinePrompt: readFileSync(
        join(packageRoot, "prompts", "baseline", "single-agent.md"),
        "utf8",
      ),
      contract,
      out,
      budgetUsd: options.budgetUsd,
      logger: createLogger(),
      systems,
      runs: options.runs,
      onRow: (row) => print(describeRow(row)),
    },
    suite.briefs,
  );
  writeReport(out, rows, stopped);
  return !stopped;
}
