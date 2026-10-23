import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { isGitProject } from "./git-delivery.ts";
import type { Storage } from "./storage.ts";

// The project folders the owner has added, and the one new tasks work on, as
// Claude Code's environments do for its sessions. Workers change a copy of
// the project; the folder itself changes only when the owner completes a task.

export type Project = { name: string; path: string };

export type ProjectCheck = Project & {
  current: boolean;
  problems: string[];
  // The gates' npm scripts the project lacks; those gates will ask the owner.
  missingScripts: string[];
  // A git work tree with a commit, even a folder inside one, can get
  // completed work on a branch of its own (git-delivery.ts).
  git: boolean;
};

export class ProjectError extends Error {}

// lint_and_typecheck_pass runs lint and typecheck; tests_pass runs test.
const checkScripts = ["lint", "typecheck", "test"];

export function currentProject(storage: Storage): string | undefined {
  return storage.getSetting<{ path: string } | null>("project")?.path;
}

// A folder chosen with `amora project` before there was a list joins it.
export function listProjects(storage: Storage): Project[] {
  const listed = storage.getSetting<Project[]>("projects") ?? [];
  const current = currentProject(storage);
  if (!current || listed.some(({ path }) => path === current)) return listed;
  return [...listed, { name: basename(current), path: current }];
}

export function folderProblem(path: string): string | undefined {
  if (!isAbsolute(path)) return "Give the folder's full path, such as /Users/you/my-app.";
  if (!existsSync(path) || !statSync(path).isDirectory()) return `${path} is not a folder.`;
  if (!existsSync(join(path, "package.json"))) {
    return `${path} has no package.json. AMORA checks work with the project's npm scripts.`;
  }
  return undefined;
}

function scriptsOf(folder: string): Record<string, string> | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return manifest.scripts ?? {};
  } catch {
    return undefined;
  }
}

export function inspectProject(project: Project, current: string | undefined): ProjectCheck {
  const problem = folderProblem(project.path);
  const scripts = problem ? {} : scriptsOf(project.path);
  const problems = [
    ...(problem ? [problem] : []),
    ...(scripts ? [] : [`${project.path}/package.json is not valid JSON.`]),
  ];
  return {
    ...project,
    current: project.path === current,
    problems,
    missingScripts: checkScripts.filter((name) => !(name in (scripts ?? {}))),
    git: !problem && isGitProject(project.path),
  };
}

// Adds the folder (or renames it, when it is already listed) and makes it the
// one new tasks work on.
export function addProject(storage: Storage, path: string, name?: string): Project {
  const folder = resolve(path);
  const problem = folderProblem(folder);
  if (problem) throw new ProjectError(problem);
  const project = { name: name?.trim() || basename(folder), path: folder };
  const others = listProjects(storage).filter((listed) => listed.path !== folder);
  storage.setSetting("projects", [...others, project]);
  storage.setSetting("project", { path: folder });
  return project;
}

// Takes the folder off the list; its files are not touched. When it was the
// current project, new tasks have none until another is chosen.
export function removeProject(storage: Storage, path: string): void {
  storage.setSetting(
    "projects",
    listProjects(storage).filter((project) => project.path !== path),
  );
  if (currentProject(storage) === path) storage.setSetting("project", null);
}

export function chooseProject(storage: Storage, path: string): void {
  if (!listProjects(storage).some((project) => project.path === path)) {
    throw new ProjectError("Add the project first.");
  }
  const problem = folderProblem(path);
  if (problem) throw new ProjectError(problem);
  storage.setSetting("project", { path });
}
