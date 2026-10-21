import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { openGraph, updateGraph } from "../src/code-graph/graph.ts";
import { parseSource } from "../src/code-graph/parse.ts";
import { callersOf, impactOf, outline } from "../src/code-graph/query.ts";
import { projectView } from "../src/runtime/workspace.ts";

function folderWith(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "amora-graph-"));
  for (const [path, content] of Object.entries(files)) write(folder, path, content);
  return folder;
}

function write(folder: string, path: string, content: string): void {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), content);
}

// The login example: a change to login() reaches signIn, which calls it, the
// page that calls signIn, and the tests of both.
const app = {
  "src/auth.ts": `export function login(user: string) { return check(user); }
function check(user: string) { return user.length > 0; }
export default function logout() {}`,
  "src/session.ts": `import { login } from "./auth.js";
export const signIn = (user: string) => login(user);`,
  "src/pages/Home.tsx": `import * as session from "../session";
import { Button } from "../ui";
export function Home() { session.signIn("a"); return <Button />; }`,
  "src/ui/index.tsx": `export function Button() { return <button />; }`,
  "src/out.ts": `import bye from "./auth";
bye();`,
  "test/auth.test.ts": `import { login } from "../src/auth.ts";
login("x");`,
  "src/notes.md": "not code",
};

describe("the code graph's parser", () => {
  it("reads definitions, imports, calls, and JSX components", () => {
    const facts = parseSource(
      "src/x.tsx",
      `import React, { useState as state } from "react";
import * as api from "./api";
import "./styles.css";
export { load } from "./load";
const legacy = require("./legacy");
export class Store { save() { api.put(1); } }
export type Note = { id: string };
export const Card = () => { state(0); return <Row />; };
export default Card;`,
    );
    assert.deepEqual(
      facts.symbols.map(({ name, kind, exported }) => [name, kind, exported]),
      [
        ["legacy", "variable", false],
        ["Store", "class", true],
        ["Store.save", "method", false],
        ["Note", "type", true],
        ["Card", "function", true],
      ],
    );
    assert.deepEqual(
      facts.imports.map(({ specifier, local, imported }) => [specifier, local, imported]),
      [
        ["react", "React", "default"],
        ["react", "state", "useState"],
        ["./api", "api", "*"],
        ["./styles.css", "", ""],
        ["./load", "", "load"],
        ["./legacy", "", "*"],
      ],
    );
    assert.deepEqual(
      facts.calls.map(({ caller, name, object }) => [caller, name, object]),
      [
        ["Store.save", "put", "api"],
        ["Card", "state", null],
        ["Card", "Row", null],
      ],
    );
    assert.equal(facts.defaultExport, "Card");
  });

  it("still reads what it can of a file that does not compile", () => {
    const facts = parseSource("src/broken.ts", "export function ok() { go(); }\nconst = ;");
    assert.equal(facts.symbols[0]?.name, "ok");
    assert.equal(facts.calls[0]?.name, "go");
  });
});

describe("the code graph", () => {
  it("answers what a change to login() reaches, tests included", () => {
    const graph = openGraph(":memory:");
    updateGraph(graph, folderWith(app));
    assert.deepEqual(
      impactOf(graph, "login").map(({ path, depth, test, why }) => [path, depth, test, why]),
      [
        ["src/auth.ts", 0, false, "defines login"],
        ["src/session.ts", 1, false, "calls login in signIn"],
        ["test/auth.test.ts", 1, true, "calls login"],
        ["src/pages/Home.tsx", 2, false, "calls signIn in Home"],
      ],
    );
    // A default import is a call of the default export, whatever its local name.
    assert.deepEqual(callersOf(graph, "src/auth.ts", "logout"), [
      { file: "src/out.ts", caller: null, line: 2 },
    ]);
    assert.deepEqual(
      impactOf(graph, "src/ui/index.tsx").map(({ path }) => path),
      ["src/ui/index.tsx", "src/pages/Home.tsx"],
    );
    assert.deepEqual(impactOf(graph, "nothing"), []);
    assert.deepEqual(outline(graph)["src/auth.ts"], ["login()", "logout()"]);
  });

  it("re-parses only changed files and follows files added and removed", () => {
    const folder = folderWith(app);
    const file = join(mkdtempSync(join(tmpdir(), "amora-graph-db-")), "graph.sqlite");
    let graph = openGraph(file);
    assert.deepEqual(updateGraph(graph, folder), { files: 6, parsed: 6, removed: 0 });
    graph.close();
    graph = openGraph(file);
    assert.deepEqual(updateGraph(graph, folder), { files: 6, parsed: 0, removed: 0 });
    write(folder, "src/session.ts", `export const signIn = () => 1;`);
    write(folder, "src/later.ts", `import { soon } from "./soon";\nexport const x = soon();`);
    rmSync(join(folder, "src/out.ts"));
    assert.deepEqual(updateGraph(graph, folder), { files: 6, parsed: 2, removed: 1 });
    assert.deepEqual(
      impactOf(graph, "login").map(({ path }) => path),
      ["src/auth.ts", "test/auth.test.ts"],
    );
    // An import of a file that did not exist yet lands once the file does.
    write(folder, "src/soon.ts", `export function soon() { return 1; }`);
    assert.deepEqual(updateGraph(graph, folder), { files: 7, parsed: 1, removed: 0 });
    assert.deepEqual(callersOf(graph, "src/soon.ts", "soon"), [
      { file: "src/later.ts", caller: "x", line: 2 },
    ]);
    graph.close();
  });
});

describe("a worker's view of a large project", () => {
  it("shows the files around the step first, and connected files outside its area", () => {
    // Forty large files in the area: without the graph, the first ones by path
    // fill the budget and the one the step is about is never shown.
    const filler = "// filler\n".repeat(400);
    const files: Record<string, string> = {
      ...app,
      "package.json": "{}",
      "test/session.test.ts": `import { signIn } from "../src/session";\nsignIn("a");`,
    };
    for (let n = 0; n < 40; n += 1) files[`src/a${String(n).padStart(2, "0")}.ts`] = filler;
    const folder = folderWith(files);
    const inArea = (path: string) => path.startsWith("src/");
    const plain = projectView(folder, inArea);
    assert.ok(!plain.contents.some(({ path }) => path === "src/session.ts"));
    const focus = { text: "Make signIn remember the user.", paths: [] };
    const view = projectView(folder, inArea, { focus });
    assert.deepEqual(
      // signIn's file, what it builds on, and what calls it: one ring, not
      // the files those reach in turn.
      view.contents.slice(0, 3).map(({ path }) => path),
      ["src/session.ts", "src/auth.ts", "src/pages/Home.tsx"],
    );
    assert.deepEqual(
      view.related.map(({ path, why }) => [path, why]),
      [["test/session.test.ts", "tests it: calls signIn"]],
    );
    assert.deepEqual(view.map["src/session.ts"], ["signIn()"]);
  });
});
