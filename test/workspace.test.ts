import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  matchesScope,
  projectGate,
  type ProjectGate,
  scopeProblems,
} from "../src/runtime/project-gates.ts";
import {
  deliver,
  insideWorkspace,
  openWorkspace,
  projectView,
  stageFiles,
} from "../src/runtime/workspace.ts";
import { manifest } from "./agency.ts";

function project(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "amora-project-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(folder, path, ".."), { recursive: true });
    writeFileSync(join(folder, path), content);
  }
  return folder;
}

const scoped = manifest("slice", {
  plugins: [{ filesystem: { scope: "src/**" } }],
  permissions: { shell: ["npm"], network: false },
});

describe("worker file scope", () => {
  it("matches scopes as globs", () => {
    assert.ok(matchesScope("src/a/b.ts", "src/**"));
    assert.ok(matchesScope("src/b.ts", "src/*.ts"));
    assert.ok(!matchesScope("src/a/b.ts", "src/*.ts"));
    assert.ok(!matchesScope("srcx/b.ts", "src/**"));
  });

  it("refuses paths that leave the project, protected files, and files outside the area", () => {
    const files = [
      "src/ok.js",
      "../escape.js",
      "src/../package.json",
      "src/../index.js",
      "/etc/passwd",
      "C:/Windows/x.js",
      "src\\win.js",
      "package.json",
      "src/.env.local",
      "src/node_modules/x.js",
      "tests/a.test.js",
      "src/ok.js",
    ].map((path) => ({ path, content: "" }));
    const problems = scopeProblems(files, ["src/**"]);
    assert.equal(problems.length, 11);
    // Matches src/** as text, but lands outside src/.
    assert.ok(problems.includes('src/../index.js must not contain empty, "." or ".." parts.'));
    assert.ok(!problems.some((problem) => /^src\/ok.js is (outside|protected)/.test(problem)));
    assert.match(problems.join("\n"), /src\/ok.js is listed twice/);
    assert.match(
      problems.join("\n"),
      /tests\/a.test.js is outside this worker's area \(src\/\*\*\)/,
    );
  });

  it("never resolves a path outside the workspace", () => {
    const workspace = mkdtempSync(join(tmpdir(), "amora-ws-"));
    assert.ok(insideWorkspace(workspace, "src/a.js"));
    assert.equal(insideWorkspace(workspace, "../a.js"), undefined);
    assert.equal(insideWorkspace(workspace, "src/../../a.js"), undefined);
    assert.equal(insideWorkspace(workspace, "."), undefined);
  });
});

describe("task workspace", () => {
  it("copies the project without node_modules or .git, and puts files back when a gate fails", () => {
    const folder = project({ "src/a.js": "old", ".git/HEAD": "x", "node_modules/m/index.js": "" });
    const workspace = join(mkdtempSync(join(tmpdir(), "amora-ws-")), "task");
    openWorkspace(folder, workspace);
    assert.ok(!existsSync(join(workspace, ".git")));
    const undo = stageFiles(workspace, [
      { path: "src/a.js", content: "new" },
      { path: "src/b.js", content: "added" },
    ]);
    assert.equal(readFileSync(join(workspace, "src/a.js"), "utf8"), "new");
    undo();
    assert.equal(readFileSync(join(workspace, "src/a.js"), "utf8"), "old");
    assert.ok(!existsSync(join(workspace, "src/b.js")));
    assert.equal(readFileSync(join(folder, "src/a.js"), "utf8"), "old");
  });

  it("shows a worker its area's files with secrets redacted and .env files left out", () => {
    const key = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;
    const folder = project({
      "package.json": "{}",
      "src/a.js": `const key = "${key}";`,
      "src/.env": "SECRET=1",
      "docs/x.md": "not in the area",
    });
    const view = projectView(folder, (path) => path.startsWith("src/"));
    assert.deepEqual(view.files, ["docs/x.md", "package.json", "src/.env", "src/a.js"]);
    assert.deepEqual(
      view.contents.map(({ path }) => path),
      ["src/a.js"],
    );
    assert.ok(!JSON.stringify(view).includes(key));
    assert.equal(view.package_json, "{}");
  });

  it("delivers only files that exist in the workspace, inside the project", () => {
    const workspace = project({ "src/a.js": "done" });
    const target = project({});
    assert.deepEqual(deliver(workspace, target, ["src/a.js", "src/missing.js", "../x.js"]), [
      "src/a.js",
    ]);
    assert.equal(readFileSync(join(target, "src/a.js"), "utf8"), "done");
  });
});

async function outcome(gate: ProjectGate, name: string) {
  const run = gate.runners[name];
  if (!run) throw new Error(`no ${name} check`);
  return run(undefined);
}

describe("project gate", () => {
  const output = { files: [{ path: "src/a.js", content: "export const a = 1;\n" }] };

  it("keeps the files when the gate passes and removes them when it does not", async () => {
    const workspace = project({ "package.json": "{}" });
    const passing = projectGate(workspace, scoped, output);
    assert.equal((await outcome(passing, "files_in_scope")).result, "passed");
    assert.deepEqual(passing.finish(true), ["src/a.js"]);
    assert.ok(existsSync(join(workspace, "src/a.js")));
    const other = project({ "package.json": "{}" });
    const failing = projectGate(other, scoped, output);
    await outcome(failing, "files_in_scope");
    assert.deepEqual(failing.finish(false), []);
    assert.ok(!existsSync(join(other, "src/a.js")));
  });

  it("blocks scripts the project lacks, npm the manifest does not allow, or checks run out of order", async () => {
    const workspace = project({ "package.json": '{"scripts":{"build":"true"}}' });
    const gate = projectGate(workspace, scoped, output);
    assert.match((await outcome(gate, "tests_pass")).reason, /files_in_scope must come before/);
    await outcome(gate, "files_in_scope");
    const missing = await outcome(gate, "lint_and_typecheck_pass");
    assert.equal(missing?.result, "blocked");
    assert.match(missing?.reason ?? "", /no lint or typecheck script/);
    const noNpm = projectGate(
      workspace,
      { ...scoped, permissions: { shell: [], network: false } },
      output,
    );
    await outcome(noNpm, "files_in_scope");
    assert.match((await outcome(noNpm, "tests_pass")).reason, /may not run npm/);
  });

  it("runs model-written code without the owner's environment", async () => {
    process.env.AMORA_CANARY = "a key someone exported";
    const script = 'node -e "process.exit(process.env.AMORA_CANARY ? 1 : 0)"';
    const workspace = project({ "package.json": JSON.stringify({ scripts: { test: script } }) });
    const gate = projectGate(workspace, scoped, output);
    await outcome(gate, "files_in_scope");
    const tests = await outcome(gate, "tests_pass");
    delete process.env.AMORA_CANARY;
    assert.equal(tests.result, "passed", tests.findings.join("\n"));
  });

  it("returns a failing script's output as findings", async () => {
    const script = "node -e \"console.error('2 tests failed'); process.exit(1)\"";
    const workspace = project({ "package.json": JSON.stringify({ scripts: { test: script } }) });
    const gate = projectGate(workspace, scoped, output);
    await outcome(gate, "files_in_scope");
    const tests = await outcome(gate, "tests_pass");
    assert.equal(tests.result, "failed");
    assert.equal(tests.reason, "npm run test failed.");
    assert.match(tests.findings[0] ?? "", /2 tests failed/);
  });

  it("asks for a project folder when the task has none", async () => {
    const gate = projectGate(undefined, scoped, output);
    assert.match((await outcome(gate, "files_in_scope")).reason, /no project folder/);
  });
});
