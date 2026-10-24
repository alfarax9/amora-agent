import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// The package.json AMORA writes into a project that has none, such as an
// empty folder for new code, so its gates have scripts to run. AMORA writes
// it, never a model: a script is a command the gates run. Its typecheck
// checks the syntax of every JavaScript and TypeScript file with Node alone
// (templates/starter/check.mjs) and its test runs node --test, so nothing
// needs installing first.

const checker = new URL("../../templates/starter/check.mjs", import.meta.url);

// npm names are lowercase, without spaces, and may not start with . or _.
function packageName(folder: string): string {
  const name = basename(folder)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|-+$/g, "");
  return name || "app";
}

function starterFiles(folder: string): Record<string, string> {
  const manifest = {
    name: packageName(folder),
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { typecheck: "node --no-warnings scripts/check.mjs", test: "node --test" },
  };
  return {
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "scripts/check.mjs": readFileSync(checker, "utf8"),
  };
}

// Writes the starter files, or nothing at all when one of them is already
// there: the owner's files stay as they are. Returns the files in the way.
export function writeStarter(folder: string): string[] {
  const files = starterFiles(folder);
  const taken = Object.keys(files).filter((path) => existsSync(join(folder, path)));
  if (taken.length > 0) return taken;
  mkdirSync(join(folder, "scripts"), { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(folder, path), text);
  return [];
}
