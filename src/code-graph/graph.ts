import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type FileFacts, parseSource, sourceExtensions } from "./parse.ts";

// The code graph of one folder, kept in one SQLite file: each source file's
// names, imports, and calls (parse.ts). It is a cache of the folder, so a
// schema change drops it and an update re-parses only files whose content
// hash changed.

export type CodeGraph = { database: DatabaseSync; close(): void };

const version = 1;

const schema = `
CREATE TABLE files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, is_test INTEGER NOT NULL, default_export TEXT);
CREATE TABLE symbols (file TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, end_line INTEGER NOT NULL, exported INTEGER NOT NULL);
CREATE TABLE imports (file TEXT NOT NULL, specifier TEXT NOT NULL, local TEXT NOT NULL, imported TEXT NOT NULL, target TEXT);
CREATE TABLE calls (file TEXT NOT NULL, caller TEXT, name TEXT NOT NULL, object TEXT, line INTEGER NOT NULL);
CREATE INDEX symbols_name ON symbols (name);
CREATE INDEX symbols_file ON symbols (file);
CREATE INDEX imports_file ON imports (file);
CREATE INDEX imports_target ON imports (target);
CREATE INDEX calls_file ON calls (file);
CREATE INDEX calls_name ON calls (name);
`;

export function openGraph(path: string): CodeGraph {
  mkdirSync(dirname(path), { recursive: true });
  // The CLI and an MCP server may update the same project's graph at once.
  const database = new DatabaseSync(path, { timeout: 5000 });
  const { user_version: found } = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (found !== version) {
    for (const table of ["files", "symbols", "imports", "calls"]) {
      database.exec(`DROP TABLE IF EXISTS ${table}`);
    }
    database.exec(schema);
    database.exec(`PRAGMA user_version = ${version}`);
  }
  return { database, close: () => database.close() };
}

// Built output, installed packages, and history are not the project's code.
const skipped = new Set(["node_modules", ".git", "dist", "build", "coverage", "out"]);
// A file this large is a bundle or generated data, not code to read.
const maxFileBytes = 1_000_000;
const maxFiles = 20_000;

const isSource = (name: string) =>
  sourceExtensions.some((extension) => name.endsWith(extension)) && !name.endsWith(".d.ts");

function listSources(folder: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (found.length >= maxFiles || skipped.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isSource(entry.name) && statSync(full).size <= maxFileBytes) {
        found.push(relative(folder, full).split(sep).join("/"));
      }
    }
  };
  walk(folder);
  return found.sort();
}

const isTestPath = (path: string) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)(__tests__|tests?)\//.test(path);

// "./api" from src/app.tsx is src/api.ts, src/api.tsx, src/api/index.ts, and
// so on; "./api.js" may name src/api.ts, as TypeScript's ESM imports do.
// Packages and path aliases resolve to nothing: they are not files here.
function resolveSpecifier(from: string, specifier: string, files: Set<string>) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const base = specifier.startsWith("/")
    ? specifier.slice(1)
    : posix.normalize(posix.join(posix.dirname(from), specifier));
  const stem = base.replace(/\.[cm]?jsx?$/, "");
  const candidates = [
    base,
    ...sourceExtensions.map((extension) => `${stem}${extension}`),
    ...sourceExtensions.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function store(graph: CodeGraph, path: string, hash: string, facts: FileFacts, files: Set<string>) {
  const { database } = graph;
  forget(graph, path);
  database
    .prepare("INSERT INTO files (path, hash, is_test, default_export) VALUES (?, ?, ?, ?)")
    .run(path, hash, isTestPath(path) ? 1 : 0, facts.defaultExport);
  const symbol = database.prepare("INSERT INTO symbols VALUES (?, ?, ?, ?, ?, ?)");
  for (const s of facts.symbols)
    symbol.run(path, s.name, s.kind, s.line, s.endLine, s.exported ? 1 : 0);
  const imported = database.prepare("INSERT INTO imports VALUES (?, ?, ?, ?, ?)");
  for (const i of facts.imports) {
    imported.run(
      path,
      i.specifier,
      i.local,
      i.imported,
      resolveSpecifier(path, i.specifier, files),
    );
  }
  const called = database.prepare("INSERT INTO calls VALUES (?, ?, ?, ?, ?)");
  for (const c of facts.calls) called.run(path, c.caller, c.name, c.object, c.line);
}

function forget({ database }: CodeGraph, path: string): void {
  for (const table of ["files", "symbols", "imports", "calls"]) {
    const column = table === "files" ? "path" : "file";
    database.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(path);
  }
}

// A file added or removed can change where any relative import lands.
function resolveAgain({ database }: CodeGraph, files: Set<string>): void {
  const rows = database.prepare("SELECT rowid, file, specifier FROM imports").all() as {
    rowid: number;
    file: string;
    specifier: string;
  }[];
  const update = database.prepare("UPDATE imports SET target = ? WHERE rowid = ?");
  for (const row of rows) update.run(resolveSpecifier(row.file, row.specifier, files), row.rowid);
}

export type GraphUpdate = { files: number; parsed: number; removed: number };

export function updateGraph(graph: CodeGraph, folder: string): GraphUpdate {
  const paths = listSources(folder);
  const files = new Set(paths);
  const known = new Map(
    (
      graph.database.prepare("SELECT path, hash FROM files").all() as {
        path: string;
        hash: string;
      }[]
    ).map(({ path, hash }) => [path, hash]),
  );
  const gone = [...known.keys()].filter((path) => !files.has(path));
  let parsed = 0;
  graph.database.exec("BEGIN");
  try {
    for (const path of gone) forget(graph, path);
    for (const path of paths) {
      const text = readFileSync(join(folder, path), "utf8");
      const hash = createHash("sha256").update(text).digest("hex");
      if (known.get(path) === hash) continue;
      store(graph, path, hash, parseSource(path, text), files);
      parsed += 1;
    }
    if (gone.length > 0 || paths.some((path) => !known.has(path))) resolveAgain(graph, files);
    graph.database.exec("COMMIT");
  } catch (error) {
    graph.database.exec("ROLLBACK");
    throw error;
  }
  return { files: paths.length, parsed, removed: gone.length };
}
