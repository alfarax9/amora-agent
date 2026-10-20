import { runHeadless } from "../runtime/headless.ts";
import { createLogger } from "../runtime/logger.ts";
import { createOrchestrator } from "../runtime/orchestrator.ts";
import { agencyFor } from "./agency.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";
import { projectPath } from "./project.ts";

// `amora run "<brief>"`: a task without the dashboard, for scripts, CI, and
// other agents. The exit code says how far it got (runtime/headless.ts), and
// --json prints one object a program can read instead of the transcript.

export type RunFlags = { budget: string; approve: boolean; complete: boolean; json: boolean };

export async function runTaskCommand(
  context: AppContext,
  brief: string,
  flags: RunFlags,
): Promise<boolean> {
  const project = projectPath(context);
  const budgetUsd = Number(flags.budget);
  if (!project) return (printError("Set the project first: amora project <path>"), false);
  if (!(budgetUsd > 0)) return (printError("--budget must be an amount in USD above 0."), false);
  const orchestrator = createOrchestrator(agencyFor(context), { logger: createLogger() });
  const options = { brief, budgetUsd, project, approve: flags.approve, complete: flags.complete };
  const result = await runHeadless(orchestrator, context.storage, options, (line) => {
    if (!flags.json) print(line);
  });
  const { task } = result;
  if (flags.json) {
    const summary = task
      ? {
          id: task.id,
          status: task.status,
          step: task.step,
          steps: task.plan?.steps.length ?? 0,
          spentUsd: task.spentUsd,
          budgetUsd: task.budgetUsd,
          resumeAt: task.resumeAt ?? null,
        }
      : null;
    print(JSON.stringify({ code: result.code, report: result.report, task: summary }));
  } else print(result.report);
  // 0 reached, 1 needs a decision, 3 paused for quota; main keeps a non-zero code.
  process.exitCode = result.code;
  return true;
}
