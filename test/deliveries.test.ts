import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { deliverTracked, undoableTasks, undoDelivery } from "../src/runtime/deliveries.ts";
import { openStorage } from "../src/runtime/storage.ts";
import { createTask } from "../src/runtime/task-store.ts";

function write(folder: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), content);
  }
}

const read = (folder: string, path: string) => readFileSync(join(folder, path), "utf8");

// An AMORA home with one task that replaces src/page.js and adds src/extra.js.
function delivered() {
  const home = mkdtempSync(join(tmpdir(), "amora-home-"));
  const storage = openStorage(join(home, "amora.db"));
  const project = mkdtempSync(join(tmpdir(), "amora-project-"));
  write(project, { "src/page.js": "old page", "README.md": "readme" });
  const workspace = mkdtempSync(join(tmpdir(), "amora-workspace-"));
  write(workspace, { "src/page.js": "new page", "src/extra.js": "extra" });
  const backups = join(home, "backups");
  const task = createTask(storage, "Add a page and an extra.", 1, new Date(), project);
  const paths = ["src/page.js", "src/extra.js", "src/page.js", "../outside.js", "src/missing.js"];
  const shipment = { taskId: task.id, workspace, project, backups };
  const written = deliverTracked(storage, shipment, paths);
  return { home, storage, project, backups, id: task.id, written };
}

describe("delivery ledger", () => {
  it("records each file it writes and backs up the one it replaces", () => {
    const { storage, project, backups, id, written } = delivered();
    assert.deepEqual(written, ["src/extra.js", "src/page.js"]);
    assert.equal(read(project, "src/page.js"), "new page");
    assert.equal(read(join(backups, id), "src/page.js"), "old page");
    assert.equal(existsSync(join(backups, id, "src", "extra.js")), false);
    assert.deepEqual(
      undoableTasks(storage).map(({ taskId, files }) => [taskId, files]),
      [[id, 2]],
    );
  });

  it("puts the project back: replaced files come back, new files go", () => {
    const { storage, project, backups, id } = delivered();
    const undo = undoDelivery(storage, id, { backups });
    assert.deepEqual(undo, { restored: ["src/page.js"], removed: ["src/extra.js"], changed: [] });
    assert.equal(read(project, "src/page.js"), "old page");
    assert.equal(existsSync(join(project, "src", "extra.js")), false);
    assert.equal(read(project, "README.md"), "readme");
    assert.deepEqual(undoableTasks(storage), []);
    assert.deepEqual(undoDelivery(storage, id, { backups }), {
      restored: [],
      removed: [],
      changed: [],
    });
  });

  it("leaves a file the owner changed alone, unless forced, and then keeps their version", () => {
    const { storage, project, backups, id } = delivered();
    write(project, { "src/page.js": "owner edit" });
    const refused = undoDelivery(storage, id, { backups });
    assert.deepEqual(refused, { restored: [], removed: [], changed: ["src/page.js"] });
    assert.equal(read(project, "src/page.js"), "owner edit");
    assert.ok(existsSync(join(project, "src", "extra.js")));
    const forced = undoDelivery(storage, id, { backups, force: true });
    assert.deepEqual(forced.restored, ["src/page.js"]);
    assert.equal(read(project, "src/page.js"), "old page");
    const [kept] = readdirSync(join(backups, id)).filter((name) => name.startsWith("owner-"));
    assert.equal(read(join(backups, id, kept ?? ""), "src/page.js"), "owner edit");
  });

  it("counts a file the owner deleted as changed", () => {
    const { storage, project, backups, id } = delivered();
    rmSync(join(project, "src", "extra.js"));
    assert.deepEqual(undoDelivery(storage, id, { backups }).changed, ["src/extra.js"]);
  });
});

describe("delivery ledger and secrets (S6)", () => {
  it("refuses to record a path that looks like a key, before writing anything", () => {
    const { storage, project, backups, id } = delivered();
    const workspace = mkdtempSync(join(tmpdir(), "amora-workspace-"));
    const name = `sk-or-v1-${"a1b2c3d4".repeat(8)}.js`;
    write(workspace, { [name]: "x" });
    assert.throws(
      () => deliverTracked(storage, { taskId: id, workspace, project, backups }, [name]),
      /Refusing to store/,
    );
    assert.equal(existsSync(join(project, name)), false);
    assert.equal(undoableTasks(storage)[0]?.files, 2);
  });
});
