import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { type Agency, taskWorkspace } from "./agency.ts";
import { type Desk, drive, move, Refusal, save, say, startWork } from "./dispatch.ts";
import { redactSecrets } from "./secret-scanner.ts";
import { listHandoffs, type Task } from "./task-store.ts";
import { insideWorkspace } from "./workspace.ts";

// Reviewing a task's work before Complete (Orca's "annotate AI diffs"): the
// owner sees each file as it would change their project, and notes on a file
// send the work back to the step that wrote it, so the steps after it run
// again on the fixed work.

export type FileChange = { path: string; status: "added" | "modified"; diff: string };

const maxDiffChars = 20_000;
const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";

// git's own diff, which also works outside a repository; without git, the new
// file's text is shown whole.
function diffOf(before: string | undefined, after: string): string {
  try {
    execFileSync(
      "git",
      ["diff", "--no-index", "--no-color", "-U3", "--", before ?? nullFile, after],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return "";
  } catch (error) {
    const { stdout, status } = error as { stdout?: Buffer; status?: number };
    if (status === 1 && stdout) return stdout.toString("utf8");
    return readFileSync(after, "utf8");
  }
}

// Each file the task's passed steps wrote, as it would change the project.
export function taskChanges(agency: Agency, task: Task): FileChange[] {
  const workspace = taskWorkspace(agency, task);
  if (!workspace || !task.project) return [];
  const written = new Set(
    listHandoffs(agency.storage, task.id)
      .filter(({ gate }) => gate === "passed")
      .flatMap(({ artifacts }) => artifacts),
  );
  return [...written].sort().flatMap((path) => {
    const after = insideWorkspace(workspace, path);
    const target = insideWorkspace(task.project ?? "", path);
    if (!after || !target || !existsSync(after)) return [];
    const before = existsSync(target) ? target : undefined;
    const raw = diffOf(before, after);
    // git names the workspace's temporary paths; the owner knows the file by its own.
    const hunks = raw.includes("@@") ? raw.slice(raw.indexOf("@@")) : raw;
    const diff = redactSecrets(hunks).slice(0, maxDiffChars);
    if (before && diff === "") return [];
    return [{ path, status: before ? "modified" : "added", diff } satisfies FileChange];
  });
}

export type ReviewNote = { file: string; text: string };

// The earliest step whose passed work wrote one of the noted files, or the
// last step when the notes name none of them.
function stepFor(task: Task, notes: ReviewNote[], agency: Agency): number {
  const steps = task.plan?.steps ?? [];
  const files = new Set(notes.map(({ file }) => file));
  const writers = new Set(
    listHandoffs(agency.storage, task.id)
      .filter(
        ({ gate, artifacts }) => gate === "passed" && artifacts.some((path) => files.has(path)),
      )
      .map(({ sender }) => sender),
  );
  const first = steps.findIndex(({ worker }) => writers.has(worker));
  return first >= 0 ? first : steps.length - 1;
}

export function requestChanges(desk: Desk, task: Task, notes: ReviewNote[]): Task {
  if (!task.plan || task.step < task.plan.steps.length) {
    throw new Refusal("Changes can be asked for once every step passed its gate.");
  }
  if (notes.length === 0) throw new Refusal("Write a note on at least one file first.");
  const lines = notes.map(({ file, text }) => (file ? `${file}: ${text}` : text));
  say(desk, task.id, "owner", `Change this before completing:\n${lines.join("\n")}`);
  const step = stepFor(task, notes, desk.agency);
  const feedback = [
    "The owner reviewed the changes before completing and asks for this:",
    ...lines,
  ];
  const back = save(desk, { ...task, step, attempt: 0, feedback });
  const moved = move(desk, back, "running");
  startWork(desk, task.id, () => drive(desk, task.id));
  return moved;
}
