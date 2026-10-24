import { resolve } from "node:path";
import {
  addProject,
  currentProject,
  inspectProject,
  ProjectError,
  setUpProject,
} from "../runtime/projects.ts";
import { type DeliveryMode, deliveryMode } from "../runtime/ship.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

export function projectPath(context: Pick<AppContext, "storage">): string | undefined {
  return currentProject(context.storage);
}

// The folder named, or the current one, added to the list, and with --setup
// given AMORA's starter package.json.
function chosenFolder(context: AppContext, path: string | undefined, setup: boolean): string {
  const current = projectPath(context);
  if (path === undefined && !current)
    throw new ProjectError("Name the folder: amora project <path>");
  const folder =
    path === undefined ? (current as string) : addProject(context.storage, resolve(path)).path;
  if (setup) setUpProject(context.storage, folder);
  return folder;
}

// New tasks work on this folder, which joins the projects the dashboard's
// picker lists. Workers change a copy of it; the folder itself changes only
// when the owner completes a task.
export function runProject(context: AppContext, path: string | undefined, setup = false): boolean {
  if (path === undefined && !setup) {
    const current = projectPath(context);
    print(
      current ? `New tasks work on ${current}.` : "No project folder yet: amora project <path>",
    );
    return true;
  }
  let folder: string;
  try {
    folder = chosenFolder(context, path, setup);
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error;
    return (printError(error.message), false);
  }
  print(`New tasks work on ${folder}.`);
  print("Workers change a copy; this folder changes only when you complete a task.");
  const { missingScripts, needsSetup } = inspectProject({ name: "", path: folder }, folder);
  if (setup) print("AMORA wrote package.json and scripts/check.mjs, so the checks can run.");
  if (needsSetup) {
    print("It has no package.json yet. Let AMORA write a starter one: amora project --setup");
  } else if (missingScripts.length > 0) {
    print(
      `It has no ${missingScripts.join(" or ")} script, so the gates that need them will ask you.`,
    );
  }
  return true;
}

const modes: Record<DeliveryMode, string> = {
  branch:
    "In a git project, a completed task's files become a commit on a branch of their own (amora/<task>); your working tree stays as it is. Elsewhere they are copied in, with backups.",
  files:
    "A completed task's files are copied into the project, with backups of the files they replace.",
};

// `amora delivery [branch|files]`: how a completed task reaches the project.
export function runDelivery(context: AppContext, mode: string | undefined): boolean {
  if (mode !== undefined) {
    if (mode !== "branch" && mode !== "files") {
      return (printError(`There is no ${mode} delivery. Choose branch or files.`), false);
    }
    context.storage.setSetting("delivery", { mode });
  }
  print(modes[deliveryMode(context)]);
  return true;
}
