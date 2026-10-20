import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Hidden acceptance for the React fixture. The delivered project must build;
// then the brief's hidden Vitest file runs inside it with the fake notes
// server, and each of its tests is reported as one test here, so the counts
// say how much of the brief works. Nothing of this is in the project while
// AMORA or the baseline works on it.

const project = process.env.PROJECT ?? "";
const windows = process.platform === "win32";

// The arguments are fixed names, never model text.
const npm = (args) =>
  spawnSync(windows ? "npm.cmd" : "npm", args, {
    cwd: project,
    encoding: "utf8",
    shell: windows,
    timeout: 120_000,
  });

const tail = (result) => `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000);

function hiddenResults(briefFolder) {
  const folder = join(project, "src", "__hidden__");
  mkdirSync(folder, { recursive: true });
  cpSync(join(briefFolder, "hidden.test.tsx"), join(folder, "acceptance.test.tsx"));
  for (const helper of ["notes-server.ts", "fake-api.ts"]) {
    cpSync(join(dirname(fileURLToPath(import.meta.url)), helper), join(folder, helper));
  }
  const report = join(mkdtempSync(join(tmpdir(), "amora-hidden-")), "report.json");
  const run = npm([
    "exec",
    "--",
    "vitest",
    "run",
    "src/__hidden__",
    "--reporter=json",
    `--outputFile=${report}`,
  ]);
  rmSync(folder, { recursive: true, force: true });
  if (!existsSync(report)) return { results: [], output: tail(run) };
  const { testResults } = JSON.parse(readFileSync(report, "utf8"));
  return { results: testResults.flatMap((file) => file.assertionResults), output: tail(run) };
}

export function reactAcceptance(briefUrl) {
  const build = npm(["run", "--silent", "build"]);
  test("the project builds", () => assert.equal(build.status, 0, tail(build)));
  const { results, output } = hiddenResults(dirname(fileURLToPath(briefUrl)));
  if (results.length === 0) test("the hidden tests run", () => assert.fail(output));
  for (const result of results) {
    test(result.fullName, () =>
      assert.equal(result.status, "passed", result.failureMessages.join("\n").slice(0, 2000)),
    );
  }
}
