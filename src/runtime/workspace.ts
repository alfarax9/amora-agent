import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type Focus, mapOf, pickFiles } from "../code-graph/focus.ts";
import { openGraph, updateGraph } from "../code-graph/graph.ts";
import { redactSecrets } from "./secret-scanner.ts";

// Each task works on its own copy of the project, under ~/.amora/workspaces.
// Workers' files are written there and checked there; the owner's folder only
// changes when they complete the task (PRD §4 step 7).

// Never copied, never shown to a worker, never written by one.
const skippedFolders = new Set(["node_modules", ".git"]);

export type FileChange = { path: string; content: string };

export function openWorkspace(project: string, workspace: string): void {
  if (existsSync(workspace)) return;
  cpSync(project, workspace, {
    recursive: true,
    filter: (source) => !skippedFolders.has(basename(source)),
  });
  // The project's installed packages are shared, not copied: checks need them,
  // and a copy of node_modules would be slow and large.
  const modules = join(project, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(workspace, "node_modules"), "junction");
}

// A worker's path, resolved inside the workspace, or nothing when it would
// land anywhere else.
export function insideWorkspace(workspace: string, path: string): string | undefined {
  const full = resolve(workspace, path);
  const from = relative(workspace, full);
  // On Windows, a path on another drive comes back absolute.
  const outside = from === "" || from === ".." || from.startsWith(`..${sep}`) || isAbsolute(from);
  return outside ? undefined : full;
}

// Writes files and returns how to put the workspace back as it was, for a gate
// that does not pass.
export function stageFiles(workspace: string, files: FileChange[]): () => void {
  const previous = files.map(({ path }) => {
    const full = insideWorkspace(workspace, path);
    if (!full) throw new Error(`${path} is outside the workspace.`);
    return { full, content: existsSync(full) ? readFileSync(full, "utf8") : undefined };
  });
  for (const [index, { full }] of previous.entries()) {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, files[index]?.content ?? "");
  }
  return () => {
    for (const { full, content } of previous.reverse()) {
      if (content === undefined) rmSync(full, { force: true });
      else writeFileSync(full, content);
    }
  };
}

function listFiles(workspace: string, limit = 300): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (found.length >= limit || skippedFolders.has(entry.name)) continue;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(relative(workspace, full).split(sep).join("/"));
    }
  };
  walk(workspace);
  return found.sort();
}

// Copies the files the task's passed steps wrote into the owner's folder, and
// returns their paths.
export function deliver(workspace: string, project: string, paths: string[]): string[] {
  const delivered: string[] = [];
  for (const path of [...new Set(paths)].sort()) {
    const from = insideWorkspace(workspace, path);
    const to = insideWorkspace(project, path);
    if (!from || !to || !existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    delivered.push(path);
  }
  return delivered;
}

// Enough characters for a small project's files in one worker's area; a large
// project gets the file list and as many files as fit.
const contentBudget = 40_000;
// The outline of a large project is cut here; a small one fits whole.
const mapBudget = 6_000;

export type ViewOptions = {
  // What the step is about; without it, files come in path order.
  focus?: Focus;
  // Where the code graph is kept between steps; in memory when not given.
  graphFile?: string;
};

type Reader = { read(path: string): string; used: number };

// One shared budget, so the files the code graph picked come first, and a
// file that would not fit is left out rather than cut.
function take(reader: Reader, path: string): string | undefined {
  if (basename(path).startsWith(".env")) return undefined;
  const content = reader.read(path);
  if (reader.used + content.length > contentBudget) return undefined;
  reader.used += content.length;
  return content;
}

function graphPicks(workspace: string, { focus, graphFile = ":memory:" }: ViewOptions) {
  const graph = openGraph(graphFile);
  try {
    updateGraph(graph, workspace);
    const picked = focus ? pickFiles(graph, focus) : [];
    return { picked, map: mapOf(graph, picked, mapBudget) };
  } finally {
    graph.close();
  }
}

// What a worker sees of the project: every file's path, the package manifest,
// an outline of each source file's exported names, the files of its own area,
// and, read only, files outside its area that the code graph connects to the
// step. Contents pass the secret scanner before they are sent to a model, and
// .env files never are.
export function projectView(
  workspace: string,
  inArea: (path: string) => boolean,
  options: ViewOptions = {},
) {
  const files = listFiles(workspace);
  const reader: Reader = {
    read: (path) => redactSecrets(readFileSync(join(workspace, path), "utf8")),
    used: 0,
  };
  const { picked, map } = graphPicks(workspace, options);
  const contents: FileChange[] = [];
  const related: (FileChange & { why: string })[] = [];
  for (const { path, why } of picked) {
    const content = take(reader, path);
    if (content === undefined) continue;
    if (inArea(path)) contents.push({ path, content });
    else related.push({ path, why, content });
  }
  const shown = new Set(picked.map(({ path }) => path));
  for (const path of files) {
    if (shown.has(path) || !inArea(path)) continue;
    const content = take(reader, path);
    if (content !== undefined) contents.push({ path, content });
  }
  const packageJson = files.includes("package.json") ? reader.read("package.json") : null;
  return { files, package_json: packageJson, map, contents, related };
}
