import { join } from "node:path";
import { undoableTasks, undoDelivery } from "../runtime/deliveries.ts";
import { dataDirectory } from "../runtime/storage.ts";
import { addMessage, getTask } from "../runtime/task-store.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

// `amora undo` lists the completed tasks whose delivery can still be undone;
// `amora undo <task>` puts the owner's project back as it was before that
// delivery. A file changed since is only touched with --force, and then the
// owner's version is kept in the backups folder first.

const excerpt = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

function list(context: AppContext): boolean {
  const undoable = undoableTasks(context.storage);
  if (undoable.length === 0) return (print("No delivery can be undone."), true);
  for (const { taskId, files, at } of undoable) {
    const brief = getTask(context.storage, taskId)?.brief ?? "";
    print(
      `${taskId.slice(0, 8)}  ${at.slice(0, 16).replace("T", " ")}  ${files} files  ${excerpt(brief)}`,
    );
  }
  print("Undo one with: amora undo <task>");
  return true;
}

export function runUndo(context: AppContext, id: string | undefined, force: boolean): boolean {
  if (id === undefined) return list(context);
  const matches = undoableTasks(context.storage).filter(({ taskId }) => taskId.startsWith(id));
  const [match] = matches;
  if (!match || matches.length > 1) {
    printError(
      match
        ? `${id} matches more than one task; give more of its id.`
        : `No delivery of ${id} can be undone. See the ones that can: amora undo`,
    );
    return false;
  }
  const backups = join(dataDirectory(), "backups");
  const { restored, removed, changed } = undoDelivery(context.storage, match.taskId, {
    backups,
    force,
  });
  if (changed.length > 0 && !force) {
    printError(
      `Changed since the delivery, so nothing was undone: ${changed.join(", ")}. To undo anyway, run it again with --force; your versions are kept in ${join(backups, match.taskId)} first.`,
    );
    return false;
  }
  const kept =
    changed.length > 0 ? ` Your changed versions are kept in ${join(backups, match.taskId)}.` : "";
  const summary = `Undid the delivery: restored ${restored.length} and removed ${removed.length} files.${kept}`;
  addMessage(context.storage, match.taskId, "agency", summary);
  print(summary);
  for (const path of restored) print(`  restored ${path}`);
  for (const path of removed) print(`  removed  ${path}`);
  return true;
}
