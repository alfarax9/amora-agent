import { join } from "node:path";
import { withRetries } from "../model-layer/gateway.ts";
import type { Agency } from "../runtime/agency.ts";
import type { Contract } from "../runtime/contracts.ts";
import type { Logger } from "../runtime/logger.ts";
import { chooseRoster } from "../runtime/roster.ts";
import { redactSecrets } from "../runtime/secret-scanner.ts";
import { openWorkspace } from "../runtime/workspace.ts";
import { runAcceptance } from "./acceptance.ts";
import { emptyMeter, type Meter, metered } from "./meter.ts";
import { type Watch, watched } from "./outage.ts";
import { runSingleAgent, type SystemRun } from "./single-agent.ts";
import type { EvalBrief } from "./suite.ts";
import { runThinPath } from "./thin-path.ts";

// Runs each brief through each system on its own copy of the project, then
// scores the delivered project with the brief's hidden test. A task succeeds
// only when it was delivered and every hidden test passes. A run that ends on
// a provider failure stops the benchmark, and that brief is scored for no
// system, so the systems are still compared on the same briefs.

// AMORA with every worker, AMORA with the slim roster, and one agent.
export type System = "amora" | "slim" | "baseline";

export type EvalRow = Meter & {
  brief: string;
  run: number;
  heldOut: boolean;
  system: System;
  delivered: boolean;
  reason: string;
  passed: number;
  failed: number;
  success: boolean;
  seconds: number;
  project: string;
};

export type SuiteRun = {
  agency: Agency;
  baselineModel: string;
  baselinePrompt: string;
  contract: Contract;
  out: string;
  budgetUsd: number;
  logger: Logger;
  systems: System[];
  // Each brief runs this many times per system, to tell steady results from luck.
  runs: number;
  onRow?: (row: EvalRow) => void;
};

// The rows of the briefs every system finished, and where the run stopped
// when a provider failed.
export type SuiteResult = { rows: EvalRow[]; stopped?: string };

// The same agency, with every model call counted and watched for provider
// failures, and the run's own folder for task workspaces.
function meteredAgency(agency: Agency, meter: Meter, watch: Watch, workspaces: string): Agency {
  return {
    ...agency,
    workspaces,
    connect: async (model) => {
      const connected = await agency.connect(model);
      return { ...connected, chat: watched(metered(connected.chat, meter), watch) };
    },
  };
}

async function baseline(run: SuiteRun, agency: Agency, brief: EvalBrief, folder: string) {
  const { chat, name } = await agency.connect(run.baselineModel);
  const delays = agency.retryDelaysMs ? { retryDelaysMs: agency.retryDelaysMs } : {};
  const single = {
    chat: withRetries(chat, delays),
    model: name,
    structured: agency.lookup(run.baselineModel)?.structured_output ?? "none",
    contract: run.contract,
    prompt: run.baselinePrompt,
  };
  return runSingleAgent(single, brief.brief, join(folder, "project"), join(folder, "workspace"));
}

async function attempt(
  run: SuiteRun,
  system: System,
  brief: EvalBrief,
  folder: string,
  meter: Meter,
  watch: Watch,
) {
  const agency = meteredAgency(run.agency, meter, watch, join(folder, "workspaces"));
  try {
    if (system === "baseline") return await baseline(run, agency, brief, folder);
    const project = join(folder, "project");
    // Each system names its roster, whatever the owner's default is.
    const setting = system === "amora" ? "full" : system;
    const roster = { ...agency, roster: (text: string) => chooseRoster(setting, text) };
    return await runThinPath(roster, brief.brief, project, run.budgetUsd, run.logger);
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    return { delivered: false, reason: `The run stopped: ${message}` } satisfies SystemRun;
  }
}

async function runOne(
  run: SuiteRun,
  round: number,
  system: System,
  brief: EvalBrief,
): Promise<EvalRow | { outage: string }> {
  const folder = join(run.out, `run-${round}`, system, brief.id);
  const project = join(folder, "project");
  // Copied like a task's workspace: the fixture's installed packages are linked.
  openWorkspace(brief.project, project);
  const meter = emptyMeter();
  const watch: Watch = { failure: undefined };
  const started = Date.now();
  const outcome = await attempt(run, system, brief, folder, meter, watch);
  if (!outcome.delivered && watch.failure) return { outage: watch.failure };
  const seconds = Math.round((Date.now() - started) / 1000);
  const { passed, failed } = await runAcceptance(brief.acceptance, project);
  const success = outcome.delivered && passed > 0 && failed === 0;
  return {
    brief: brief.id,
    run: round,
    heldOut: brief.heldOut,
    system,
    ...outcome,
    passed,
    failed,
    success,
    seconds,
    project,
    ...meter,
  };
}

export async function runSuite(run: SuiteRun, briefs: EvalBrief[]): Promise<SuiteResult> {
  const rows: EvalRow[] = [];
  // Whole rounds one after another, so a run stopped early still compares the
  // systems on the same briefs.
  for (let round = 1; round <= run.runs; round += 1) {
    for (const brief of briefs) {
      const finished: EvalRow[] = [];
      for (const system of run.systems) {
        const result = await runOne(run, round, system, brief);
        if ("outage" in result) {
          return { rows, stopped: `${brief.id} (${system}, run ${round}): ${result.outage}` };
        }
        finished.push(result);
      }
      rows.push(...finished);
      for (const row of finished) run.onRow?.(row);
    }
  }
  return { rows };
}
