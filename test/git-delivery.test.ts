import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { deliverToBranch, undoBranch } from "../src/runtime/git-delivery.ts";
import { ship } from "../src/runtime/ship.ts";
import { openStorage } from "../src/runtime/storage.ts";
import { createTask, listMessages } from "../src/runtime/task-store.ts";
import { setup } from "./agency.ts";

// No identity from the machine's own git config, so a repo that names nobody
// really names nobody.
const isolated = mkdtempSync(join(tmpdir(), "amora-gitconfig-"));
writeFileSync(join(isolated, "config"), "");
process.env.GIT_CONFIG_GLOBAL = join(isolated, "config");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const git = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: "pipe" }).trim();

function write(folder: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), content);
  }
}

// A repo with one commit, an uncommitted edit, and a staged one; and a task
// workspace that changes src/page.js and adds src/extra.js.
function world() {
  const project = mkdtempSync(join(tmpdir(), "amora-repo-"));
  git(project, "init", "--quiet", "--initial-branch", "main");
  write(project, { "src/page.js": "old page", "README.md": "readme", "notes.md": "a" });
  git(project, "add", ".");
  git(
    project,
    "-c",
    "user.name=Owner",
    "-c",
    "user.email=owner@example.com",
    "commit",
    "-qm",
    "start",
  );
  write(project, { "README.md": "readme, edited", "notes.md": "b" });
  git(project, "add", "notes.md");
  const workspace = mkdtempSync(join(tmpdir(), "amora-workspace-"));
  write(workspace, { "src/page.js": "new page", "src/extra.js": "extra" });
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
  const task = createTask(storage, "Add a page and an extra.", 1, new Date(), project);
  const shipment = { taskId: task.id, workspace, project, brief: task.brief };
  return { project, workspace, storage, task, shipment };
}

const state = (project: string) => ({
  branch: git(project, "branch", "--show-current"),
  status: git(project, "status", "--porcelain"),
  staged: git(project, "diff", "--cached"),
  page: readFileSync(join(project, "src", "page.js"), "utf8"),
});

describe("delivery to a git branch", () => {
  it("commits the files to a branch of their own and leaves the checkout alone", () => {
    const { project, storage, task, shipment } = world();
    const before = state(project);
    const delivered = deliverToBranch(storage, shipment, ["src/page.js", "src/extra.js", "../x"]);
    assert.deepEqual(delivered?.files, ["src/extra.js", "src/page.js"]);
    assert.equal(delivered?.branch, `amora/${task.id.slice(0, 8)}`);
    assert.deepEqual(state(project), before);
    const branch = delivered?.branch ?? "";
    assert.equal(git(project, "show", `${branch}:src/page.js`), "new page");
    assert.equal(git(project, "show", `${branch}:README.md`), "readme");
    assert.equal(git(project, "rev-parse", `${branch}^`), git(project, "rev-parse", "HEAD"));
    assert.match(
      git(project, "log", "-1", "--format=%s%n%an", branch),
      /^AMORA: Add a page.*\nAMORA$/,
    );
  });

  it("takes a free branch name when the first is taken", () => {
    const { project, storage, task, shipment } = world();
    git(project, "branch", `amora/${task.id.slice(0, 8)}`);
    assert.equal(
      deliverToBranch(storage, shipment, ["src/page.js"])?.branch,
      `amora/${task.id.slice(0, 8)}-2`,
    );
  });

  it("leaves a folder that is not a git repo to the file delivery", () => {
    const { storage, shipment } = world();
    const plain = mkdtempSync(join(tmpdir(), "amora-plain-"));
    assert.equal(
      deliverToBranch(storage, { ...shipment, project: plain }, ["src/page.js"]),
      undefined,
    );
  });

  it("deletes the branch on undo, but not once it is merged or moved on", () => {
    const deleted = world();
    const branch =
      deliverToBranch(deleted.storage, deleted.shipment, ["src/page.js"])?.branch ?? "";
    assert.equal(undoBranch(deleted.storage, deleted.task.id), "deleted");
    assert.equal(git(deleted.project, "branch", "--list", branch), "");
    assert.equal(undoBranch(deleted.storage, deleted.task.id), "nothing");

    const merged = world();
    const mergedBranch =
      deliverToBranch(merged.storage, merged.shipment, ["src/extra.js"])?.branch ?? "";
    git(merged.project, "stash", "-q");
    git(merged.project, "merge", "-q", "--ff-only", mergedBranch);
    assert.equal(undoBranch(merged.storage, merged.task.id), "merged");

    const moved = world();
    const movedBranch =
      deliverToBranch(moved.storage, moved.shipment, ["src/extra.js"])?.branch ?? "";
    const tree = git(moved.project, "rev-parse", `${movedBranch}^{tree}`);
    const owners = execFileSync(
      "git",
      [
        "-C",
        moved.project,
        "-c",
        "user.name=O",
        "-c",
        "user.email=o@x",
        "commit-tree",
        tree,
        "-p",
        movedBranch,
        "-m",
        "more",
      ],
      { encoding: "utf8" },
    ).trim();
    git(moved.project, "update-ref", `refs/heads/${movedBranch}`, owners);
    assert.equal(undoBranch(moved.storage, moved.task.id), "moved");
    assert.equal(git(moved.project, "rev-parse", movedBranch), owners);
  });
});

describe("Complete's delivery", () => {
  it("uses a branch in a git project unless the owner chose files", () => {
    const { project, workspace } = world();
    const { agency } = setup({});
    const task = createTask(agency.storage, "Add a page.", 1, new Date(), project);
    const onBranch = ship(agency, { ...task, project }, workspace, ["src/page.js"]);
    assert.match(
      onBranch ?? "",
      /^Committed 1 files to the branch amora\/.*Your working tree is unchanged/,
    );
    assert.equal(readFileSync(join(project, "src", "page.js"), "utf8"), "old page");
    agency.storage.setSetting("delivery", { mode: "files" });
    const asFiles = ship(agency, { ...task, project }, workspace, ["src/page.js"]);
    assert.match(asFiles ?? "", /^Wrote 1 files to .*amora undo/);
    assert.equal(readFileSync(join(project, "src", "page.js"), "utf8"), "new page");
  });

  it("keeps no record of a branch git refused to create", () => {
    const { project, storage, task, shipment } = world();
    git(project, "branch", `amora/${task.id.slice(0, 8)}`);
    const locked = join(project, ".git", "refs", "heads", "amora", `${task.id.slice(0, 8)}-2.lock`);
    writeFileSync(locked, "");
    assert.throws(() => deliverToBranch(storage, shipment, ["src/page.js"]));
    assert.equal(undoBranch(storage, task.id), "nothing");
  });
});

describe("CLI: amora delivery and amora undo with a branch", () => {
  const cli = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
  const run = (home: string, args: string[]) => {
    try {
      const out = execFileSync("node", [cli, ...args], {
        env: { ...process.env, AMORA_HOME: home },
        encoding: "utf8",
        stdio: "pipe",
      });
      return { code: 0, out };
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string };
      return { code: failed.status, out: `${failed.stdout}${failed.stderr}` };
    }
  };

  it("shows and sets the delivery, and undoes a branch delivery", () => {
    const home = mkdtempSync(join(tmpdir(), "amora-home-"));
    assert.match(run(home, ["delivery"]).out, /a branch of their own/);
    assert.match(run(home, ["delivery", "files"]).out, /copied into the project/);
    assert.equal(run(home, ["delivery", "nope"]).code, 1);
    const storage = openStorage(join(home, "amora.db"));
    const project = mkdtempSync(join(tmpdir(), "amora-repo-"));
    git(project, "init", "--quiet");
    write(project, { "a.txt": "a" });
    git(project, "add", ".");
    git(project, "-c", "user.name=O", "-c", "user.email=o@x", "commit", "-qm", "start");
    const workspace = mkdtempSync(join(tmpdir(), "amora-workspace-"));
    write(workspace, { "b.txt": "b" });
    const task = createTask(storage, "Add b.", 1, new Date(), project);
    const shipment = { taskId: task.id, workspace, project, brief: task.brief };
    const branch = deliverToBranch(storage, shipment, ["b.txt"])?.branch ?? "";
    assert.match(run(home, ["undo"]).out, new RegExp(`${task.id.slice(0, 8)} .* branch ${branch}`));
    const undone = run(home, ["undo", task.id.slice(0, 8)]);
    assert.equal(undone.code, 0, undone.out);
    assert.match(undone.out, /deleted the branch/);
    assert.equal(git(project, "branch", "--list", branch), "");
    assert.match(listMessages(storage, task.id).at(-1)?.text ?? "", /^Undid the delivery: deleted/);
  });
});
