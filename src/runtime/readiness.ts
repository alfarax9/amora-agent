import { resolveWorker } from "../model-layer/slots.ts";
import type { Agency } from "./agency.ts";
import { folderProblem } from "./projects.ts";
import { plannerId } from "./roster.ts";

// What must be in place before a task is worth starting: every task begins
// with the Planner / Decomposer, can only be approved under a daily limit, and
// works on a copy of a project folder. A task sent without them only fails a
// moment later ("Planner / Decomposer has no model that fits"), so new tasks
// are refused up front, each gap with the command that closes it.

// `fix` names a gap the dashboard can close itself, with the project picker.
export type Gap = { problem: string; command: string; fix?: "project" };

type Setup = Pick<Agency, "manifests" | "slots" | "lookup" | "storage">;

function plannerGap(setup: Setup): Gap | undefined {
  const planner = setup.manifests.find(({ id }) => id === plannerId);
  if (!planner) {
    return { problem: "No Planner / Decomposer worker is installed.", command: "amora doctor" };
  }
  const resolution = resolveWorker(planner, setup.slots(), setup.lookup);
  if (resolution.verdict === "fits") return undefined;
  const problem = `The Planner / Decomposer has no model that fits: ${resolution.problems.join(" ")}`;
  if (resolution.verdict === "unprobed" && resolution.model) {
    return { problem, command: `amora models probe ${resolution.model}` };
  }
  if (resolution.verdict === "rejected") {
    return { problem, command: `amora models set worker:${plannerId} <model>` };
  }
  return { problem, command: "amora models set global <model>" };
}

// A project chosen before a folder was refused, or one that moved, would
// fail as surely as none.
function projectGap(project: string | undefined): Gap | undefined {
  const fix = "project" as const;
  if (!project) {
    const problem = "No project folder is set, so workers have no code to work on.";
    return { problem, command: "amora project <path>", fix };
  }
  const problem = folderProblem(project);
  return problem ? { problem, command: "amora project <path>", fix } : undefined;
}

export function readinessGaps(setup: Setup, project: string | undefined): Gap[] {
  const gaps: Gap[] = [];
  const planner = plannerGap(setup);
  if (planner) gaps.push(planner);
  if (setup.storage.getSetting<{ dailyUsd: number }>("budgets")?.dailyUsd === undefined) {
    const problem = "No daily limit is set, so no plan could be approved.";
    gaps.push({ problem, command: "amora budget --daily <usd>" });
  }
  const gap = projectGap(project);
  if (gap) gaps.push(gap);
  return gaps;
}
