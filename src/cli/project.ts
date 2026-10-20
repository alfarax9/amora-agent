import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type DeliveryMode, deliveryMode } from "../runtime/ship.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";

type ProjectSetting = { path: string };

// The npm scripts a task's gates run: lint_and_typecheck_pass runs lint and
// typecheck, tests_pass runs test.
const checkScripts = ["lint", "typecheck", "test"];

export function projectPath(context: Pick<AppContext, "storage">): string | undefined {
  return context.storage.getSetting<ProjectSetting>("project")?.path;
}

function scriptsOf(folder: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

// New tasks work on this folder. Workers change a copy of it; the folder itself
// changes only when the owner completes a task.
export function runProject(context: AppContext, path: string | undefined): boolean {
  if (path === undefined) {
    const current = projectPath(context);
    print(
      current ? `New tasks work on ${current}.` : "No project folder yet: amora project <path>",
    );
    return true;
  }
  const folder = resolve(path);
  if (!existsSync(join(folder, "package.json"))) {
    printError(`${folder} has no package.json. AMORA checks work with the project's npm scripts.`);
    return false;
  }
  context.storage.setSetting("project", { path: folder } satisfies ProjectSetting);
  print(`New tasks work on ${folder}.`);
  print("Workers change a copy; this folder changes only when you complete a task.");
  const missing = checkScripts.filter((name) => !(name in scriptsOf(folder)));
  if (missing.length > 0) {
    print(`It has no ${missing.join(", ")} script, so the gates that need them will ask you.`);
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
