import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckOutcome, CheckRunner } from "./gates.ts";
import type { WorkerManifest } from "./manifest-schema.ts";
import { redactSecrets } from "./secret-scanner.ts";
import { type FileChange, stageFiles } from "./workspace.ts";

// The gate checks that need the project: a worker writes only inside its
// manifest's filesystem scope, and its files pass the project's own lint,
// typecheck, and test scripts, run in the task's workspace (PRD §6.3, S8).

// Files no worker writes, whatever its scope: dependencies, history, lock
// files, and the places secrets live.
const protectedNames = [
  /^package\.json$/,
  /lock\.(json|yaml)$/,
  /^yarn\.lock$/,
  /^\.env/,
  /\.pem$/,
];
const protectedFolders = new Set(["node_modules", ".git"]);

export function scopesOf(manifest: WorkerManifest): string[] {
  return manifest.plugins.flatMap((plugin) => {
    if (typeof plugin === "string" || !("filesystem" in plugin)) return [];
    const scope = (plugin.filesystem as { scope?: unknown }).scope;
    return typeof scope === "string" ? [scope] : [];
  });
}

export function matchesScope(path: string, scope: string): boolean {
  const pattern = scope
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${pattern}$`).test(path);
}

function shapeProblem(path: string): string | undefined {
  if (path === "" || path.startsWith("/") || /\\|^[A-Za-z]:/.test(path)) {
    return `${path || "(empty)"} must be a relative path with forward slashes.`;
  }
  if (path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    return `${path} must not contain empty, "." or ".." parts.`;
  }
  return undefined;
}

function isProtected(path: string): boolean {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  return (
    parts.some((part) => protectedFolders.has(part)) || protectedNames.some((re) => re.test(name))
  );
}

function pathProblem(path: string, scopes: string[]): string | undefined {
  const shape = shapeProblem(path);
  if (shape) return shape;
  if (isProtected(path)) {
    return `${path} is protected; workers do not write dependencies, lock files, or secrets.`;
  }
  if (!scopes.some((scope) => matchesScope(path, scope))) {
    return `${path} is outside this worker's area (${scopes.join(", ") || "none"}).`;
  }
  return undefined;
}

export function scopeProblems(files: FileChange[], scopes: string[]): string[] {
  const seen = new Set<string>();
  return files.flatMap(({ path }) => {
    const duplicate = seen.has(path) ? [`${path} is listed twice.`] : [];
    seen.add(path);
    const problem = pathProblem(path, scopes);
    return problem ? [problem, ...duplicate] : duplicate;
  });
}

const scriptTimeoutMs = 180_000;
const outputTail = 3000;

// Model-written code runs here, so it gets the least it needs: no keys from
// the environment, the workspace as its folder, and a time limit.
export function cleanEnvironment(): NodeJS.ProcessEnv {
  // Where programs and temporary files are, and what Windows needs to run npm.cmd.
  const keep = ["PATH", "Path", "HOME", "TMPDIR", "USERPROFILE", "APPDATA", "TEMP", "TMP"];
  keep.push("SystemRoot", "windir", "ComSpec", "PATHEXT");
  const kept = Object.entries(process.env).filter(([name]) => keep.includes(name));
  return { ...Object.fromEntries(kept), CI: "1", NO_COLOR: "1" };
}

function runNpmScript(workspace: string, script: string): Promise<{ ok: boolean; output: string }> {
  const windows = process.platform === "win32";
  return new Promise((resolve) => {
    // The arguments are fixed names, never model text, so the shell Windows
    // needs for npm.cmd sees nothing it could interpret.
    const child = spawn(windows ? "npm.cmd" : "npm", ["run", "--silent", script], {
      cwd: workspace,
      env: cleanEnvironment(),
      shell: windows,
      timeout: scriptTimeoutMs,
    });
    let output = "";
    const collect = (chunk: Buffer) =>
      (output = (output + chunk.toString()).slice(-outputTail * 2));
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => resolve({ ok: false, output: error.message }));
    child.on("close", (code, signal) => {
      const tail = redactSecrets(output.trim()).slice(-outputTail);
      const stopped = signal ? `Stopped after ${scriptTimeoutMs / 1000} s.\n` : "";
      resolve({ ok: code === 0, output: `${stopped}${tail}` });
    });
  });
}

function scriptsIn(workspace: string): Record<string, string> {
  const file = join(workspace, "package.json");
  if (!existsSync(file)) return {};
  return (
    (JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}
  );
}

const blocked = (reason: string): CheckOutcome => ({ result: "blocked", reason, findings: [] });

async function runScripts(workspace: string, manifest: WorkerManifest, wanted: string[]) {
  if (!manifest.permissions.shell.includes("npm")) {
    return blocked(`${manifest.role} may not run npm (permissions.shell).`);
  }
  const present = Object.keys(scriptsIn(workspace));
  const scripts = wanted.filter((name) => present.includes(name));
  if (scripts.length === 0) return blocked(`The project has no ${wanted.join(" or ")} script.`);
  for (const script of scripts) {
    const { ok, output } = await runNpmScript(workspace, script);
    if (!ok) {
      return { result: "failed" as const, reason: `npm run ${script} failed.`, findings: [output] };
    }
  }
  return {
    result: "passed" as const,
    reason: `npm run ${scripts.join(", ")} passed.`,
    findings: [],
  };
}

export type ProjectGate = {
  runners: Record<string, CheckRunner>;
  // Called with the gate's result: files stay in the workspace only when it passed.
  finish(passed: boolean): string[];
};

// The files are written to the workspace only once they are known to be in
// scope, so the scripts after files_in_scope check exactly what would be kept.
export function projectGate(
  workspace: string | undefined,
  manifest: WorkerManifest,
  output: unknown,
): ProjectGate {
  const files = ((output as { files?: FileChange[] } | undefined)?.files ?? []).slice();
  let undo: (() => void) | undefined;
  const noProject = blocked("This task has no project folder: amora project <path>.");
  const staged = () => (undo ? undefined : blocked("files_in_scope must come before this check."));
  return {
    runners: {
      files_in_scope: async () => {
        if (!workspace) return noProject;
        const problems = scopeProblems(files, scopesOf(manifest));
        if (problems.length > 0) {
          return {
            result: "failed",
            reason: "Some files are outside this worker's area.",
            findings: problems,
          };
        }
        undo = stageFiles(workspace, files);
        return { result: "passed", reason: `${files.length} files in scope.`, findings: [] };
      },
      lint_and_typecheck_pass: async () =>
        !workspace
          ? noProject
          : (staged() ?? runScripts(workspace, manifest, ["lint", "typecheck"])),
      tests_pass: async () =>
        !workspace ? noProject : (staged() ?? runScripts(workspace, manifest, ["test"])),
    },
    finish(passed) {
      if (!passed) undo?.();
      return passed && undo ? files.map(({ path }) => path) : [];
    },
  };
}
