import type { CodeGraph } from "./graph.ts";
import { definitionsOf, dependenciesOf, impactOf, outline, pathsOf } from "./query.ts";

// Just-in-time context for one step: the graph picks the files a worker
// should read, so a large project shows it the code its goal touches instead
// of whichever files fit first. The step names its focus in words (goal,
// acceptance, brief) and in paths (files earlier steps wrote).

export type Focus = { text: string; paths: string[] };
export type Picked = { path: string; why: string };

// The paths a code contract's output wrote (code_change, component_pkg, and
// test_suite all carry `files`).
function writtenPaths(output: unknown): string[] {
  const files = (output as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file: { path?: unknown } | null) =>
    typeof file?.path === "string" ? [file.path] : [],
  );
}

// A step's focus: its words, and the files the steps before it wrote.
export function stepFocus(words: string[], earlier: { output: unknown }[]): Focus {
  return { text: words.join("\n"), paths: earlier.flatMap(({ output }) => writtenPaths(output)) };
}

// Enough for the files around one change; a step that names more than this
// is better served by the plain file order.
const maxPicked = 30;

// Names worth looking up: words shaped like code (`refuseSecrets`,
// `NoteList`, `max_tokens`), or any word in backticks or followed by "(".
// Plain words are left out: replaying AMORA's own commits, "task", "plan",
// and "default" matched symbols and crowded out the files that changed.
function namesIn(text: string): string[] {
  const shaped = text.match(/\b[A-Za-z$][\w$]*(?:[a-z0-9][A-Z]|_)[\w$]*/g) ?? [];
  const marked = [...text.matchAll(/`([A-Za-z_$][\w$]*)`|\b([A-Za-z_$][\w$]*)\(/g)].map(
    ([, ticked, called]) => ticked ?? called ?? "",
  );
  return [...new Set([...shaped, ...marked])].filter((name) => name.length >= 3);
}

function pathsIn(text: string, files: Set<string>): string[] {
  const mentioned = text.match(/[\w@./-]+\.[cm]?[jt]sx?\b/g) ?? [];
  return [...new Set(mentioned.map((path) => path.replace(/^\.\//, "")))].filter((path) =>
    files.has(path),
  );
}

// A seed is a whole file, or one name in it (`file#name`) when the step names
// a function: then what reaches it is that function's callers, not every
// file that imports its module.
type Seed = Picked & { target: string };

function seeds(graph: CodeGraph, focus: Focus, files: Set<string>): Seed[] {
  const whole = (why: string) => (path: string) => ({ path, why, target: path });
  return [
    ...focus.paths.filter((path) => files.has(path)).map(whole("written by an earlier step")),
    ...pathsIn(focus.text, files).map(whole("named in the step")),
    ...definitionsOf(graph, namesIn(focus.text)).map(({ file, name }) => ({
      path: file,
      why: `defines ${name}, which the step names`,
      target: `${file}#${name}`,
    })),
  ];
}

// Around each seed: what its file imports (the code it builds on), and what
// imports or calls it, tests included (the code a change to it can break).
function around(graph: CodeGraph, { path, target }: Seed): Picked[] {
  const uses = dependenciesOf(graph, path).map((dependency) => ({
    path: dependency,
    why: `imported by ${path}`,
  }));
  const usedBy = impactOf(graph, target, 1)
    .filter(({ depth }) => depth > 0)
    .map(({ path: affected, why, test }) => ({
      path: affected,
      why: test ? `tests it: ${why}` : why,
    }));
  return [...uses, ...usedBy];
}

export function pickFiles(graph: CodeGraph, focus: Focus): Picked[] {
  const files = new Set(pathsOf(graph));
  const picked = new Map<string, Picked>();
  const keep = (item: Picked) => {
    if (picked.size < maxPicked && !picked.has(item.path)) picked.set(item.path, item);
  };
  const first = seeds(graph, focus, files);
  for (const { path, why } of first) keep({ path, why });
  for (const seed of first) around(graph, seed).forEach(keep);
  return [...picked.values()];
}

// The outline of every file, the picked ones first, cut at `budget`
// characters so a large project still gets a map that fits.
export function mapOf(
  graph: CodeGraph,
  picked: Picked[],
  budget: number,
): Record<string, string[]> {
  const full = outline(graph);
  const order = [...new Set([...picked.map(({ path }) => path), ...Object.keys(full).sort()])];
  const map: Record<string, string[]> = {};
  let used = 0;
  for (const path of order) {
    const names = full[path];
    if (!names) continue;
    const size = path.length + names.join(", ").length + 8;
    if (used + size > budget) break;
    used += size;
    map[path] = names;
  }
  return map;
}
