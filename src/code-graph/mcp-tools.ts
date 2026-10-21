import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type CodeGraph, updateGraph } from "./graph.ts";
import type { Service, ToolSpec } from "./mcp.ts";
import {
  callersOf,
  definitionsNamed,
  dependenciesOf,
  impactOf,
  outline,
  pathsOf,
} from "./query.ts";

// The code graph's questions as MCP tools, for agents that use tools (Claude
// Code, Codex, CLI-agent workers). Read-only: the only write is the graph's
// own update before each answer. Answers hold paths, names, kinds, and line
// numbers, never a file's contents, and a path that leads out of the project
// is refused rather than looked up.

type Args = Record<string, unknown>;
type Tool = ToolSpec & { answer(graph: CodeGraph, root: string, args: Args): unknown };

const text = (description: string) => ({ type: "string", description });
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function argument(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required.`);
  return value.trim();
}

const optional = (args: Args, key: string) =>
  args[key] === undefined ? undefined : argument(args, key);

// A path as the graph stores it: relative to the project, with forward
// slashes. Absolute paths are compared by their real location, so a symlinked
// temporary folder still matches.
function inProject(root: string, path: string): string {
  const real = (absolute: string) => (existsSync(absolute) ? realpathSync(absolute) : absolute);
  const absolute = isAbsolute(path) ? real(resolve(path)) : resolve(root, path);
  const inside = relative(root, absolute);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`${path} is outside the project.`);
  }
  return inside.split(sep).join("/");
}

function knownFile(graph: CodeGraph, root: string, path: string): string {
  const file = inProject(root, path);
  if (!pathsOf(graph).includes(file)) throw new Error(`${file} is not a source file in the graph.`);
  return file;
}

// `file#name` and anything shaped like a path is checked as a path; a bare
// name (`login`, `Store.save`) is looked up as defined anywhere.
function impactTarget(graph: CodeGraph, root: string, target: string): string {
  const [file = "", name] = target.split("#");
  if (name !== undefined) return `${knownFile(graph, root, file)}#${name}`;
  return /[/\\]|\.\./.test(target) ? inProject(root, target) : target;
}

function depthOf(args: Args): number {
  const { depth = 2 } = args;
  if (!Number.isInteger(depth) || Number(depth) < 1 || Number(depth) > 4) {
    throw new Error("depth must be a whole number from 1 to 4.");
  }
  return Number(depth);
}

const impact: Tool = {
  name: "impact",
  description:
    "What a change to a file or function can break: the target (depth 0), what calls or imports it (1), what calls those (2), and so on, each with why it is there and whether it is a test. Use before changing code to know which files and tests to check.",
  inputSchema: schema(
    {
      target: text(
        "A project file (src/auth.ts), a function in a file (src/auth.ts#login), or a name defined anywhere (login).",
      ),
      depth: { type: "integer", minimum: 1, maximum: 4, description: "Steps outward (default 2)." },
    },
    ["target"],
  ),
  answer(graph, root, args) {
    const target = impactTarget(graph, root, argument(args, "target"));
    const affected = impactOf(graph, target, depthOf(args));
    if (affected.length === 0) {
      throw new Error(`${target} is neither a source file nor a name defined in the project.`);
    }
    return { target, affected };
  },
};

const callers: Tool = {
  name: "callers",
  description:
    "The functions that call a function, with the file and the line of the first call. Calls through imports (named, default, namespace) and within the defining file are found; calls on values (obj.method()) are not.",
  inputSchema: schema(
    {
      name: text("The function's name, as defined."),
      file: text("The file that defines it; when left out, every file that defines the name."),
    },
    ["name"],
  ),
  answer(graph, root, args) {
    const name = argument(args, "name");
    const file = optional(args, "file");
    const files = file
      ? [knownFile(graph, root, file)]
      : [...new Set(definitionsNamed(graph, name).map((found) => found.file))];
    return { name, callers: files.flatMap((defining) => callersOf(graph, defining, name)) };
  },
};

const dependencies: Tool = {
  name: "dependencies",
  description:
    "The project files a file imports (packages are left out). For the files that import it, use impact with depth 1.",
  inputSchema: schema({ file: text("A project file, such as src/app.tsx.") }, ["file"]),
  answer(graph, root, args) {
    const file = knownFile(graph, root, argument(args, "file"));
    return { file, imports: dependenciesOf(graph, file) };
  },
};

const find: Tool = {
  name: "find",
  description:
    "Where a name is defined: file, kind (function, class, method, variable, type), and first and last line. A method name also finds Class.method.",
  inputSchema: schema({ name: text("A function, class, type, or variable name.") }, ["name"]),
  answer(graph, _root, args) {
    const name = argument(args, "name");
    return { name, definitions: definitionsNamed(graph, name) };
  },
};

const outlineTool: Tool = {
  name: "outline",
  description:
    "Each source file's exported names, load() for a function and Note for anything else: a map of the project without reading its files.",
  inputSchema: schema({ path: text("Only this file or the files under this folder.") }, []),
  answer(graph, root, args) {
    const path = optional(args, "path");
    const prefix = path === undefined ? "" : inProject(root, path);
    const files = Object.entries(outline(graph)).filter(
      ([file]) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`),
    );
    return { files: Object.fromEntries(files) };
  },
};

const tools = [impact, callers, dependencies, find, outlineTool];

export function graphService(graph: CodeGraph, folder: string, version: string): Service {
  const root = realpathSync(folder);
  return {
    name: "amora-graph",
    version,
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    call(name, args) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      updateGraph(graph, folder);
      const answer = tool.answer(graph, root, args);
      return { content: [{ type: "text", text: JSON.stringify(answer) }] };
    },
  };
}
