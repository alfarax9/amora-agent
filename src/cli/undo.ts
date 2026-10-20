import { join } from "node:path";
import { undoableTasks, undoDelivery } from "../runtime/deliveries.ts";
import { branchOf, undoableBranches, undoBranch } from "../runtime/git-delivery.ts";
import { dataDirectory } from "../runtime/storage.ts";
import { addMessage, getTask } from "../runtime/task-store.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

// `amora undo` lists the completed tasks whose delivery can still be undone;
// `amora undo <task>` takes it back: a branch delivery deletes the branch, a
// file delivery puts the project back as it was. A file changed since is only
// touched with --force, and then the owner's version is kept first.

const excerpt = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

type Undoable = { taskId: string; at: string; what: string };

function undoable(context: AppContext): Undoable[] {
  const files = undoableTasks(context.storage).map(({ taskId, files: count, at }) => ({
    taskId,
    at,
    what: `${count} files`,
  }));
  const branches = undoableBranches(context.storage).map(({ taskId, branch, at }) => ({
    taskId,
    at,
    what: `branch ${branch}`,
  }));
  return [...files, ...branches].sort((a, b) => b.at.localeCompare(a.at));
}

function list(context: AppContext): boolean {
  const rows = undoable(context);
  if (rows.length === 0) return (print("No delivery can be undone."), true);
  for (const { taskId, at, what } of rows) {
    const brief = getTask(context.storage, taskId)?.brief ?? "";
    print(
      `${taskId.slice(0, 8)}  ${at.slice(0, 16).replace("T", " ")}  ${what}  ${excerpt(brief)}`,
    );
  }
  print("Undo one with: amora undo <task>");
  return true;
}

const branchAnswers: Record<string, string> = {
  moved: "has commits added since it was delivered; delete it yourself if you no longer want it",
  merged: "is already merged; undo it with git revert",
};

function undoTaskBranch(context: AppContext, taskId: string, branch: string): boolean {
  const outcome = undoBranch(context.storage, taskId);
  if (outcome !== "deleted") {
    return (printError(`The branch ${branch} ${branchAnswers[outcome] ?? outcome}.`), false);
  }
  const summary = `Undid the delivery: deleted the branch ${branch}.`;
  addMessage(context.storage, taskId, "agency", summary);
  return (print(summary), true);
}

function undoFiles(context: AppContext, taskId: string, force: boolean): boolean {
  const backups = join(dataDirectory(), "backups");
  const { restored, removed, changed } = undoDelivery(context.storage, taskId, { backups, force });
  if (changed.length > 0 && !force) {
    printError(
      `Changed since the delivery, so nothing was undone: ${changed.join(", ")}. To undo anyway, run it again with --force; your versions are kept in ${join(backups, taskId)} first.`,
    );
    return false;
  }
  const kept =
    changed.length > 0 ? ` Your changed versions are kept in ${join(backups, taskId)}.` : "";
  const summary = `Undid the delivery: restored ${restored.length} and removed ${removed.length} files.${kept}`;
  addMessage(context.storage, taskId, "agency", summary);
  print(summary);
  for (const path of restored) print(`  restored ${path}`);
  for (const path of removed) print(`  removed  ${path}`);
  return true;
}

export function runUndo(context: AppContext, id: string | undefined, force: boolean): boolean {
  if (id === undefined) return list(context);
  const matches = [...new Set(undoable(context).map(({ taskId }) => taskId))].filter((taskId) =>
    taskId.startsWith(id),
  );
  const [taskId] = matches;
  if (!taskId || matches.length > 1) {
    printError(
      taskId
        ? `${id} matches more than one task; give more of its id.`
        : `No delivery of ${id} can be undone. See the ones that can: amora undo`,
    );
    return false;
  }
  const branch = branchOf(context.storage, taskId);
  return branch
    ? undoTaskBranch(context, taskId, branch.branch)
    : undoFiles(context, taskId, force);
}
