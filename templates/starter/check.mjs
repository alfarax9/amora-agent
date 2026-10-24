// AMORA's typecheck for a project it set up: the syntax of every JavaScript
// and TypeScript file, checked with Node alone, so nothing needs installing.
// TypeScript is checked once Node has stripped its types, so a wrong type
// still passes; give the project a real typecheck script when it has one.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceFile = /\.[cm]?[jt]s$/;

function sources(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sources(path);
    }
    return sourceFile.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

// node --check reads JavaScript only, so TypeScript is checked as the
// JavaScript left once its types are stripped: .ts as .js, .mts as .mjs.
function check(file, scratch) {
  const extension = extname(file);
  const options = { stdio: "pipe" };
  if (!extension.endsWith("ts")) return execFileSync(process.execPath, ["--check", file], options);
  const stripped = join(scratch, `stripped${extension.replace("t", "j")}`);
  writeFileSync(stripped, stripTypeScriptTypes(readFileSync(file, "utf8")));
  return execFileSync(process.execPath, ["--check", stripped], options);
}

// Node's message, naming the file as the project does and without the stack.
function readable(error, file) {
  const name = relative(root, file);
  const said = String(error.stderr?.length ? error.stderr : error.message)
    .split("\n")
    .filter((line) => !/^\s+at |^Node\.js v/.test(line))
    .join("\n")
    .replaceAll(file, name)
    .replace(/\S*stripped\.[cm]?js/g, name)
    .trim();
  return said.startsWith(name) ? said : `${name}: ${said}`;
}

const scratch = mkdtempSync(join(tmpdir(), "amora-check-"));
const files = sources(root);
const problems = [];
for (const file of files) {
  try {
    check(file, scratch);
  } catch (error) {
    problems.push(readable(error, file));
  }
}
rmSync(scratch, { recursive: true, force: true });
if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n\n")}\n`);
  process.exitCode = 1;
} else {
  const count = files.length === 1 ? "1 file" : `${files.length} files`;
  process.stdout.write(`Checked ${count}: the syntax is valid.\n`);
}
