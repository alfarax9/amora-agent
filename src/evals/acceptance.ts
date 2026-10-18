import { spawn } from "node:child_process";
import { cleanEnvironment } from "../runtime/project-gates.ts";
import { redactSecrets } from "../runtime/secret-scanner.ts";

// Runs a brief's hidden acceptance test against a delivered project. The test
// imports the project's code, which models wrote, so it gets the same cleaned
// environment and time limit as the project's own checks.

export type Acceptance = { passed: number; failed: number; output: string };

function count(output: string, label: string): number {
  return Number(output.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? 0);
}

export function runAcceptance(
  testFile: string,
  project: string,
  timeoutMs = 60_000,
): Promise<Acceptance> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--test", "--test-force-exit", "--test-reporter=tap", testFile],
      { env: { ...cleanEnvironment(), PROJECT: project }, timeout: timeoutMs },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", () => {
      // A file that runs no tests is reported as one passing test named after
      // the file, which says nothing about the brief; it counts as a failure,
      // as does output with no results at all.
      const escaped = testFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const empty = new RegExp(`^ok \\d+ - ${escaped}$`, "m").test(output);
      const passed = empty ? 0 : count(output, "pass");
      const failed = empty ? 1 : count(output, "fail") || (passed === 0 ? 1 : 0);
      resolve({ passed, failed, output: redactSecrets(output).slice(-3000) });
    });
  });
}
