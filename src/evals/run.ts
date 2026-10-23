import { join } from "node:path";
import { withRetries } from "../model-layer/gateway.ts";
import type { Agency } from "../runtime/agency.ts";
import type { Contract } from "../runtime/contracts.ts";
import type { Logger } from "../runtime/logger.ts";
import { chooseRoster } from "../runtime/roster.ts";
import { redactSecrets } from "../runtime/secret-scanner.ts";
import { openWorkspace } from "../runtime/workspace.ts";
import { runAcceptance } from "./acceptance.ts";
import { addMeter, type Attempt, bestOf } from "./best-of.ts";
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

// AMORA with the Full team, AMORA with the Small team, AMORA choosing between
// them by weighing each brief, the same twice in parallel keeping the better
// attempt (best-of.ts), and one agent.
export type System = "full" | "small" | "auto" | "best-of-2" | "single-agent";

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
// failures, and the run's own folders for task workspaces and backups.
function meteredAgency(agency: Agency, meter: Meter, watch: Watch, folder: string): Agency {
  return {
    ...agency,
    workspaces: join(folder, "workspaces"),
    backups: join(folder, "backups"),
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

const stoppedBy = (error: unknown): SystemRun => {
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  return { delivered: false, reason: `The run stopped: ${message}` };
};

// Each system names its roster, whatever the owner's default is.
function thinPath(
  run: SuiteRun,
  setting: string,
  brief: EvalBrief,
  folder: string,
  agency: Agency,
) {
  const roster = { ...agency, roster: (text: string) => chooseRoster(setting, text) };
  return runThinPath(roster, brief.brief, join(folder, "project"), run.budgetUsd, run.logger);
}

async function bestOfTwo(
  run: SuiteRun,
  brief: EvalBrief,
  folder: string,
  meter: Meter,
  watch: Watch,
) {
  const attempts: Attempt[] = await Promise.all(
    [1, 2].map(async (n) => {
      const own = join(folder, `attempt-${n}`);
      openWorkspace(brief.project, join(own, "project"));
      const ownMeter = emptyMeter();
      const agency = meteredAgency(run.agency, ownMeter, watch, own);
      const result = await thinPath(run, "auto", brief, own, agency).catch(stoppedBy);
      return { ...result, project: join(own, "project"), meter: ownMeter };
    }),
  );
  for (const each of attempts) addMeter(meter, each.meter);
  const best = bestOf(attempts);
  const which = `attempt ${attempts.indexOf(best) + 1} of 2`;
  return { delivered: best.delivered, reason: `${best.reason} (${which})`, project: best.project };
}

async function attempt(
  run: SuiteRun,
  system: System,
  brief: EvalBrief,
  folder: string,
  meter: Meter,
  watch: Watch,
): Promise<SystemRun & { project?: string }> {
  if (system === "best-of-2") return bestOfTwo(run, brief, folder, meter, watch);
  const agency = meteredAgency(run.agency, meter, watch, folder);
  try {
    if (system === "single-agent") return await baseline(run, agency, brief, folder);
    return await thinPath(run, system, brief, folder, agency);
  } catch (error) {
    return stoppedBy(error);
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
  // best-of-2 scores the attempt it kept, in that attempt's own folder.
  const { project: kept = project, ...outcome } = await attempt(
    run,
    system,
    brief,
    folder,
    meter,
    watch,
  );
  if (!outcome.delivered && watch.failure) return { outage: watch.failure };
  const seconds = Math.round((Date.now() - started) / 1000);
  const { passed, failed } = await runAcceptance(brief.acceptance, kept);
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
    project: kept,
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
