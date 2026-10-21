import type { CodeGraph } from "./graph.ts";

// Questions the code graph answers without reading the files: who calls a
// function, who imports a file, what a change can break and which tests cover
// it, and a one-line outline of every file.

export type Affected = { path: string; why: string; depth: number; test: boolean };

type Row = Record<string, string | number | null>;

const all = ({ database }: CodeGraph, sql: string, ...values: (string | number)[]) =>
  database.prepare(sql).all(...values) as Row[];

// Calls of `name` as file defines it: through a named or default import, a
// namespace import (`api.load()`), or from inside the same file. One row per
// calling function, with the line of its first call.
const callersSql = `
SELECT file, caller, MIN(line) AS line FROM (
SELECT c.file, c.caller, c.line FROM calls c JOIN imports i ON i.file = c.file
  JOIN files f ON f.path = i.target
  WHERE i.target = ?1 AND c.object IS NULL AND i.local = c.name
    AND (i.imported = ?2 OR (i.imported = 'default' AND f.default_export = ?2))
UNION ALL
SELECT c.file, c.caller, c.line FROM calls c JOIN imports i ON i.file = c.file
  WHERE i.target = ?1 AND i.imported = '*' AND c.object = i.local AND c.name = ?2
UNION ALL
SELECT file, caller, line FROM calls WHERE file = ?1 AND object IS NULL AND name = ?2
  AND (caller IS NULL OR caller <> ?2)
) GROUP BY file, caller ORDER BY file, caller`;

export function callersOf(graph: CodeGraph, file: string, name: string) {
  return all(graph, callersSql, file, name).map((row) => ({
    file: String(row.file),
    caller: row.caller === null ? null : String(row.caller),
    line: Number(row.line),
  }));
}

export const pathsOf = (graph: CodeGraph) =>
  all(graph, "SELECT path FROM files ORDER BY path").map((row) => String(row.path));

const importersOf = (graph: CodeGraph, file: string) =>
  all(graph, "SELECT DISTINCT file FROM imports WHERE target = ? AND file <> ?", file, file).map(
    (row) => String(row.file),
  );

export const dependenciesOf = (graph: CodeGraph, file: string) =>
  all(graph, "SELECT DISTINCT target FROM imports WHERE file = ? AND target IS NOT NULL", file).map(
    (row) => String(row.target),
  );

const isTest = (graph: CodeGraph, path: string) =>
  all(graph, "SELECT is_test FROM files WHERE path = ?", path)[0]?.is_test === 1;

// A known file, `file#name`, or a name defined anywhere, as the places it is
// defined.
function seedsOf(graph: CodeGraph, target: string): { file: string; name: string | null }[] {
  const [file, name] = target.split("#");
  if (file && name) return [{ file, name }];
  if (all(graph, "SELECT 1 FROM files WHERE path = ?", target).length > 0) {
    return [{ file: target, name: null }];
  }
  return all(graph, "SELECT DISTINCT file FROM symbols WHERE name = ?", target).map((row) => ({
    file: String(row.file),
    name: target,
  }));
}

// A place a change can reach: a function in a file, or a whole file (top-level
// code, or a file asked about as a whole).
type Reach = { file: string; name: string | null };

// One step outward: the callers of a function, or the importers of a file.
function outward(graph: CodeGraph, { file, name }: Reach): (Reach & { why: string })[] {
  if (name === null) {
    return importersOf(graph, file).map((importer) => ({
      file: importer,
      name: null,
      why: `imports ${file}`,
    }));
  }
  return callersOf(graph, file, name).map(({ file: from, caller }) => ({
    file: from,
    name: caller,
    why: `calls ${name}${caller ? ` in ${caller}` : ""}`,
  }));
}

// Everything a change to `target` can reach within `depth` steps: its callers,
// their callers, and so on, through whole files only where the call is made
// at the top level. Tests are in the list like any other file.
export function impactOf(graph: CodeGraph, target: string, depth = 2, limit = 50): Affected[] {
  const found = new Map<string, Affected>();
  const seen = new Set<string>();
  let ring = seedsOf(graph, target);
  for (const { file, name } of ring) {
    const why = name ? `defines ${name}` : "the file itself";
    found.set(file, { path: file, why, depth: 0, test: isTest(graph, file) });
    seen.add(`${file}#${name}`);
  }
  for (let level = 1; level <= depth && found.size < limit; level += 1) {
    const next: Reach[] = [];
    for (const reach of ring.flatMap((item) => outward(graph, item))) {
      if (seen.has(`${reach.file}#${reach.name}`)) continue;
      seen.add(`${reach.file}#${reach.name}`);
      next.push(reach);
      if (!found.has(reach.file)) {
        const test = isTest(graph, reach.file);
        found.set(reach.file, { path: reach.file, why: reach.why, depth: level, test });
      }
    }
    ring = next;
  }
  return [...found.values()].slice(0, limit);
}

// Files that define any of these names, for names a brief or goal mentions.
export function definitionsOf(graph: CodeGraph, names: string[]) {
  if (names.length === 0) return [];
  const marks = names.map(() => "?").join(", ");
  const sql = `SELECT DISTINCT file, name FROM symbols WHERE name IN (${marks}) AND (exported = 1 OR kind IN ('function', 'class'))`;
  return all(graph, sql, ...names).map((row) => ({
    file: String(row.file),
    name: String(row.name),
  }));
}

// Where a name is defined, exported or not: `save` finds a function save and
// a method Store.save.
export function definitionsNamed(graph: CodeGraph, name: string) {
  const sql = `SELECT file, name, kind, line, end_line FROM symbols
    WHERE name = ?1 OR substr(name, -length(?1) - 1) = '.' || ?1 ORDER BY file, line`;
  return all(graph, sql, name).map((row) => ({
    file: String(row.file),
    name: String(row.name),
    kind: String(row.kind),
    line: Number(row.line),
    endLine: Number(row.end_line),
  }));
}

// Each file's exported names, `load()` for a function and `Note` for the rest.
export function outline(graph: CodeGraph): Record<string, string[]> {
  const rows = all(
    graph,
    "SELECT file, name, kind FROM symbols WHERE exported = 1 ORDER BY file, line",
  );
  const map: Record<string, string[]> = {};
  for (const { file, name, kind } of rows) {
    const shown = kind === "function" ? `${String(name)}()` : String(name);
    (map[String(file)] ??= []).push(shown);
  }
  return map;
}
