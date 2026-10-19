import { cpSync } from "node:fs";
import { join } from "node:path";
import { withRetries } from "../model-layer/gateway.ts";
import type { Agency } from "../runtime/agency.ts";
import type { Contract } from "../runtime/contracts.ts";
import type { Logger } from "../runtime/logger.ts";
import { rosterProfiles } from "../runtime/roster.ts";
import { redactSecrets } from "../runtime/secret-scanner.ts";
import { runAcceptance } from "./acceptance.ts";
import { emptyMeter, type Meter, metered } from "./meter.ts";
import { runSingleAgent, type SystemRun } from "./single-agent.ts";
import type { EvalBrief } from "./suite.ts";
import { runThinPath } from "./thin-path.ts";

// Runs each brief through each system on its own copy of the project, then
// scores the delivered project with the brief's hidden test. A task succeeds
// only when it was delivered and every hidden test passes.

// AMORA with every worker, AMORA with the slim roster, and one agent.
export type System = "amora" | "slim" | "baseline";

export type EvalRow = Meter & {
  brief: string;
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
  onRow?: (row: EvalRow) => void;
};

// The same agency, with every model call counted and the run's own folder for
// task workspaces.
function meteredAgency(agency: Agency, meter: Meter, workspaces: string): Agency {
  return {
    ...agency,
    workspaces,
    connect: async (model) => {
      const connected = await agency.connect(model);
      return { ...connected, chat: metered(connected.chat, meter) };
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
) {
  const agency = meteredAgency(run.agency, meter, join(folder, "workspaces"));
  try {
    if (system === "baseline") return await baseline(run, agency, brief, folder);
    const project = join(folder, "project");
    const offered = system === "slim" ? rosterProfiles.slim : undefined;
    const roster = offered ? { ...agency, offered } : agency;
    return await runThinPath(roster, brief.brief, project, run.budgetUsd, run.logger);
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    return { delivered: false, reason: `The run stopped: ${message}` } satisfies SystemRun;
  }
}

async function runOne(run: SuiteRun, system: System, brief: EvalBrief): Promise<EvalRow> {
  const folder = join(run.out, system, brief.id);
  const project = join(folder, "project");
  cpSync(brief.project, project, { recursive: true });
  const meter = emptyMeter();
  const started = Date.now();
  const outcome = await attempt(run, system, brief, folder, meter);
  const seconds = Math.round((Date.now() - started) / 1000);
  const { passed, failed } = await runAcceptance(brief.acceptance, project);
  const success = outcome.delivered && passed > 0 && failed === 0;
  return {
    brief: brief.id,
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

export async function runSuite(run: SuiteRun, briefs: EvalBrief[]): Promise<EvalRow[]> {
  const rows: EvalRow[] = [];
  for (const brief of briefs) {
    for (const system of run.systems) {
      const row = await runOne(run, system, brief);
      rows.push(row);
      run.onRow?.(row);
    }
  }
  return rows;
}
