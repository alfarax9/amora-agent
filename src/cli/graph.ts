import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import { openGraph, updateGraph } from "../code-graph/graph.ts";
import { serveMcp } from "../code-graph/mcp.ts";
import { graphService } from "../code-graph/mcp-tools.ts";
import { impactOf } from "../code-graph/query.ts";
import { createLogger } from "../runtime/logger.ts";
import { dataDirectory } from "../runtime/storage.ts";
import type { AppContext } from "./context.ts";
import { print, printError } from "./output.ts";
import { projectPath } from "./project.ts";

// The code graph of the owner's project, for asking what a change reaches
// before giving AMORA the task. Tasks keep their own graph next to their
// workspace; this one lives in the AMORA home, one file per project folder.

function graphFile(folder: string): string {
  const id = createHash("sha256").update(realpathSync(folder)).digest("hex").slice(0, 16);
  return join(dataDirectory(), "graphs", `${id}.sqlite`);
}

function folderOf(context: AppContext, path: string | undefined): string | undefined {
  const folder = path === undefined ? projectPath(context) : resolve(path);
  if (!folder) return (printError("No project folder yet: amora project <path>"), undefined);
  if (!existsSync(folder)) return (printError(`${folder} does not exist.`), undefined);
  return folder;
}

// `amora graph [path]`: builds or updates the graph and says what it holds.
export function runGraph(context: AppContext, path: string | undefined): boolean {
  const folder = folderOf(context, path);
  if (!folder) return false;
  const graph = openGraph(graphFile(folder));
  try {
    const started = performance.now();
    const { files, parsed, removed } = updateGraph(graph, folder);
    const ms = Math.round(performance.now() - started);
    print(`${folder}: ${files} source files, ${parsed} parsed, ${removed} removed (${ms} ms).`);
    print("Ask what a change reaches: amora graph impact <file or function>");
    return true;
  } finally {
    graph.close();
  }
}

// `amora graph impact <target>`: the files a change to a file or function can
// reach, nearest first, with why each one is there.
export function runImpact(context: AppContext, target: string): boolean {
  const folder = folderOf(context, undefined);
  if (!folder) return false;
  const graph = openGraph(graphFile(folder));
  try {
    updateGraph(graph, folder);
    const affected = impactOf(graph, target);
    if (affected.length === 0) {
      printError(`${target} is neither a source file nor a name defined in ${folder}.`);
      return false;
    }
    for (const { path, why, depth, test } of affected) {
      print(`${depth}  ${test ? "test " : "     "}${path}  (${why})`);
    }
    const tests = affected.filter(({ test }) => test).length;
    print(
      `${affected.length} files, ${tests} of them tests. 0 is the target, 1 calls it, 2 calls those.`,
    );
    return true;
  } finally {
    graph.close();
  }
}

// `amora graph mcp [path]`: the graph as an MCP server on stdin and stdout,
// for agents that call tools. Errors before it starts go to stderr, which the
// client shows; stdout carries protocol messages only.
export async function runGraphMcp(context: AppContext, path: string | undefined): Promise<boolean> {
  const folder = folderOf(context, path);
  if (!folder) return false;
  const graph = openGraph(graphFile(folder));
  try {
    const service = graphService(graph, folder, packageJson.version);
    await serveMcp(service, process.stdin, (line) => process.stdout.write(line), createLogger());
    return true;
  } finally {
    graph.close();
  }
}
