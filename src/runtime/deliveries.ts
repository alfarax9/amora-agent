import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { refuseSecrets, type Storage } from "./storage.ts";
import { insideWorkspace } from "./workspace.ts";

// The delivery ledger: every file AMORA writes into the owner's project when a
// task is completed is recorded with its hash before and after, and a file it
// replaces is copied to the backups folder first. So a delivery can be undone,
// and a file the owner changed afterwards is never overwritten without a copy
// of their version (the install ledger idea of agency-agents-app).

type Delivery = {
  taskId: string;
  project: string;
  path: string;
  beforeHash: string | null;
  afterHash: string;
  backup: string | null;
  deliveredAt: string;
};

type DeliveryRow = {
  id: number;
  task_id: string;
  project: string;
  path: string;
  before_hash: string | null;
  after_hash: string;
  backup: string | null;
  delivered_at: string;
};

const hashOf = (file: string) =>
  existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;

function copyInto(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function record(storage: Storage, delivery: Delivery): void {
  storage.database
    .prepare(
      "INSERT INTO deliveries (task_id, project, path, before_hash, after_hash, backup, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      delivery.taskId,
      delivery.project,
      delivery.path,
      delivery.beforeHash,
      delivery.afterHash,
      delivery.backup,
      delivery.deliveredAt,
    );
}

type Shipment = { taskId: string; workspace: string; project: string; backups: string };

// Copies the files the task's passed steps wrote into the owner's folder,
// backing up each file it replaces, and returns the paths it wrote. Every path
// is checked before the first file is written (S6), so a refused path leaves
// the project as it was.
export function deliverTracked(
  storage: Storage,
  { taskId, workspace, project, backups }: Shipment,
  paths: string[],
  now = new Date(),
): string[] {
  const planned = [...new Set(paths)].sort().flatMap((path) => {
    const from = insideWorkspace(workspace, path);
    const to = insideWorkspace(project, path);
    return from && to && existsSync(from) ? [{ path, from, to }] : [];
  });
  for (const { path } of planned) {
    for (const text of [project, path, join(backups, taskId, path)]) {
      refuseSecrets(text, "the delivery ledger");
    }
  }
  for (const { path, from, to } of planned) {
    const beforeHash = hashOf(to);
    const backup = beforeHash ? join(backups, taskId, path) : null;
    if (backup) copyInto(to, backup);
    copyInto(from, to);
    const afterHash = hashOf(to) ?? "";
    const deliveredAt = now.toISOString();
    record(storage, { taskId, project, path, beforeHash, afterHash, backup, deliveredAt });
  }
  return planned.map(({ path }) => path);
}

function rowsOf(storage: Storage, taskId: string): DeliveryRow[] {
  return storage.database
    .prepare("SELECT * FROM deliveries WHERE task_id = ? AND undone_at IS NULL ORDER BY id")
    .all(taskId) as DeliveryRow[];
}

// Tasks with a delivery that can still be undone, newest first.
export function undoableTasks(storage: Storage): { taskId: string; files: number; at: string }[] {
  return storage.database
    .prepare(
      "SELECT task_id AS taskId, COUNT(*) AS files, MAX(delivered_at) AS at FROM deliveries WHERE undone_at IS NULL GROUP BY task_id ORDER BY at DESC",
    )
    .all() as { taskId: string; files: number; at: string }[];
}

export type Undo = { restored: string[]; removed: string[]; changed: string[] };

// Puts the owner's folder back as it was before the task's delivery: replaced
// files come back from their backup, new files are removed. A file the owner
// changed since is left alone unless `force`, which first keeps a copy of
// their version next to the backups.
export function undoDelivery(
  storage: Storage,
  taskId: string,
  { backups, force = false, now = new Date() }: { backups: string; force?: boolean; now?: Date },
): Undo {
  const rows = rowsOf(storage, taskId);
  const target = (row: DeliveryRow) => insideWorkspace(row.project, row.path) ?? "";
  const changed = rows
    .filter((row) => hashOf(target(row)) !== row.after_hash)
    .map(({ path }) => path);
  const result: Undo = { restored: [], removed: [], changed };
  if (rows.length === 0 || (changed.length > 0 && !force)) return result;
  const kept = join(backups, taskId, `owner-${now.toISOString().replace(/[:.]/g, "-")}`);
  for (const row of rows) {
    const file = target(row);
    if (changed.includes(row.path) && existsSync(file)) copyInto(file, join(kept, row.path));
    if (row.backup) {
      copyInto(row.backup, file);
      result.restored.push(row.path);
    } else {
      rmSync(file, { force: true });
      result.removed.push(row.path);
    }
  }
  storage.database
    .prepare("UPDATE deliveries SET undone_at = ? WHERE task_id = ? AND undone_at IS NULL")
    .run(now.toISOString(), taskId);
  return result;
}
