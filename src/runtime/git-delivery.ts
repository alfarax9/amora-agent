import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseSecrets, type Storage } from "./storage.ts";
import { insideWorkspace } from "./workspace.ts";

// Delivery to a git project: the files go into one commit on a new branch,
// amora/<task>, built with git's plumbing on a private index, so the owner's
// working tree, index, and checked-out branch stay exactly as they were and no
// hook runs. They review and merge it as they would a colleague's branch
// (Orca's worktree-per-task model), and undoing it is deleting the branch.

type Git = (args: string[], env?: NodeJS.ProcessEnv) => string;

function gitIn(project: string): Git {
  return (args, env = {}) =>
    execFileSync("git", ["-C", project, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function tryGit(git: Git, args: string[]): string | undefined {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

// The commit the project's checkout is on, or nothing when it is not a git
// work tree with a commit (or git is missing): then the files are copied.
function gitHead(project: string): string | undefined {
  return tryGit(gitIn(project), ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
}

// Commits need an author; AMORA signs as itself when the repo names nobody.
function identity(git: Git): NodeJS.ProcessEnv {
  if (tryGit(git, ["config", "user.email"])) return {};
  const who = { name: "AMORA", email: "amora@localhost" };
  return {
    GIT_AUTHOR_NAME: who.name,
    GIT_AUTHOR_EMAIL: who.email,
    GIT_COMMITTER_NAME: who.name,
    GIT_COMMITTER_EMAIL: who.email,
  };
}

function freeBranch(git: Git, base: string): string {
  for (let n = 1; n <= 100; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!tryGit(git, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])) return name;
  }
  throw new Error(`Every branch name from ${base} to ${base}-100 is taken.`);
}

// The tree of HEAD with the delivered files on top, written with a private
// index that is removed afterwards.
function treeWith(git: Git, head: string, files: { path: string; from: string }[]): string {
  const folder = mkdtempSync(join(tmpdir(), "amora-index-"));
  const env = { GIT_INDEX_FILE: join(folder, "index") };
  try {
    git(["read-tree", head], env);
    const prefix = git(["rev-parse", "--show-prefix"]);
    for (const { path, from } of files) {
      const blob = git(["hash-object", "-w", "--", from]);
      const mode = statSync(from).mode & 0o111 ? "100755" : "100644";
      git(["update-index", "--add", "--cacheinfo", `${mode},${blob},${prefix}${path}`], env);
    }
    return git(["write-tree"], env);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export type BranchDelivery = { branch: string; commit: string; files: string[] };

type Shipment = { taskId: string; workspace: string; project: string; brief: string };

// Returns the branch, or nothing when the project has no git history to build
// on, so the caller copies the files instead.
export function deliverToBranch(
  storage: Storage,
  { taskId, workspace, project, brief }: Shipment,
  paths: string[],
  now = new Date(),
): BranchDelivery | undefined {
  const head = gitHead(project);
  if (!head) return undefined;
  const git = gitIn(project);
  const files = [...new Set(paths)].sort().flatMap((path) => {
    const from = insideWorkspace(workspace, path);
    return from && insideWorkspace(project, path) && statSync(from, { throwIfNoEntry: false })
      ? [{ path, from }]
      : [];
  });
  for (const { path } of files) refuseSecrets(path, "a delivery branch");
  const tree = treeWith(git, head, files);
  // Nothing differs from the checkout's commit: no branch, nothing delivered.
  if (tree === git(["rev-parse", `${head}^{tree}`])) return { branch: "", commit: head, files: [] };
  const title = brief.length > 60 ? `${brief.slice(0, 57)}...` : brief;
  const message = `AMORA: ${title}\n\nTask ${taskId}.`;
  refuseSecrets(message, "a delivery commit");
  const commit = git(["commit-tree", tree, "-p", head, "-m", message], identity(git));
  const branch = freeBranch(git, `amora/${taskId.slice(0, 8)}`);
  // Recorded before the branch exists, so a branch never outlives its record;
  // until update-ref, the commit is an unreachable object git cleans up itself.
  const { lastInsertRowid } = storage.database
    .prepare(
      "INSERT INTO branch_deliveries (task_id, project, branch, commit_id, delivered_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(taskId, project, branch, commit, now.toISOString());
  try {
    git(["update-ref", `refs/heads/${branch}`, commit, ""]);
  } catch (error) {
    storage.database.prepare("DELETE FROM branch_deliveries WHERE id = ?").run(lastInsertRowid);
    throw error;
  }
  return { branch, commit, files: files.map(({ path }) => path) };
}

type BranchRow = { project: string; branch: string; commit_id: string };

function branchOf(storage: Storage, taskId: string): BranchRow | undefined {
  return storage.database
    .prepare(
      "SELECT project, branch, commit_id FROM branch_deliveries WHERE task_id = ? AND undone_at IS NULL",
    )
    .get(taskId) as BranchRow | undefined;
}

// Deletes the branch, unless it was merged (then only a revert undoes it) or
// moved on since (then the commits on it are the owner's).
export function undoBranch(storage: Storage, taskId: string, now = new Date()): string {
  const row = branchOf(storage, taskId);
  if (!row) return "nothing";
  const git = gitIn(row.project);
  const tip = tryGit(git, ["rev-parse", "--verify", "--quiet", `refs/heads/${row.branch}`]);
  if (tip && tip !== row.commit_id) return "moved";
  if (tryGit(git, ["merge-base", "--is-ancestor", row.commit_id, "HEAD"]) !== undefined) {
    return "merged";
  }
  if (tip) git(["update-ref", "-d", `refs/heads/${row.branch}`, row.commit_id]);
  storage.database
    .prepare("UPDATE branch_deliveries SET undone_at = ? WHERE task_id = ? AND undone_at IS NULL")
    .run(now.toISOString(), taskId);
  return "deleted";
}
