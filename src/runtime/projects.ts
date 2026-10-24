import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { isGitProject } from "./git-delivery.ts";
import { writeStarter } from "./starter.ts";
import type { Storage } from "./storage.ts";

// The project folders the owner has added, and the one new tasks work on, as
// Claude Code's environments do for its sessions. Workers change a copy of
// the project; the folder itself changes only when the owner completes a task.

export type Project = { name: string; path: string };

export type ProjectCheck = Project & {
  current: boolean;
  problems: string[];
  // No package.json yet, as in an empty folder for new code: AMORA can write
  // a starter one (setUpProject).
  needsSetup: boolean;
  // The gates' npm scripts the project lacks; those gates will ask the owner.
  missingScripts: string[];
  // A git work tree with a commit, even a folder inside one, can get
  // completed work on a branch of its own (git-delivery.ts).
  git: boolean;
};

export class ProjectError extends Error {}

// lint_and_typecheck_pass runs lint and typecheck, tests_pass runs test; a
// gate runs whichever of its scripts the project has, and asks the owner only
// when it has none of them.
const gateScripts = [["lint", "typecheck"], ["test"]];

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

// The home folder and the folders above it hold far more than a project: a
// task copies its whole project into a workspace, so they are refused even
// when a stray package.json sits in them.
export function holdsHome(path: string, home = homedir()): boolean {
  const down = relative(path, home);
  return !down.startsWith("..") && !isAbsolute(down);
}

export function folderProblem(path: string, home = homedir()): string | undefined {
  if (!isAbsolute(path)) return "Give the folder's full path, such as /Users/you/my-app.";
  if (holdsHome(path, home)) {
    return `${path} holds your whole home folder. Choose the project's own folder inside it.`;
  }
  if (!existsSync(path) || !statSync(path).isDirectory()) return `${path} is not a folder.`;
  return undefined;
}

export const hasPackageJson = (folder: string) => existsSync(join(folder, "package.json"));

function scriptsOf(folder: string): Record<string, string> | undefined {
  if (!hasPackageJson(folder)) return {};
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
    needsSetup: !problem && !hasPackageJson(project.path),
    missingScripts: gateScripts
      .filter((names) => names.every((name) => !(name in (scripts ?? {}))))
      .flat(),
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

function listedFolder(storage: Storage, path: string): void {
  if (!listProjects(storage).some((project) => project.path === path)) {
    throw new ProjectError("Add the project first.");
  }
  const problem = folderProblem(path);
  if (problem) throw new ProjectError(problem);
}

export function chooseProject(storage: Storage, path: string): void {
  listedFolder(storage, path);
  storage.setSetting("project", { path });
}

// Writes AMORA's starter package.json (starter.ts) into a listed project.
export function setUpProject(storage: Storage, path: string): void {
  listedFolder(storage, path);
  const taken = writeStarter(path);
  if (taken.length > 0) {
    throw new ProjectError(`${path} already has ${taken.join(" and ")}, so nothing was written.`);
  }
}
