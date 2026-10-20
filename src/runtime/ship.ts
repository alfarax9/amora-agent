import type { Agency } from "./agency.ts";
import { deliverTracked } from "./deliveries.ts";
import { deliverToBranch } from "./git-delivery.ts";
import type { Task } from "./task-store.ts";

// What Complete does with the files every passed step wrote. In a git project
// they become a commit on a branch of their own and the working tree is left
// alone (git-delivery.ts); otherwise they are copied in, with backups of the
// files they replace (deliveries.ts). Returns what to tell the owner.

type DeliveryMode = "branch" | "files";

function deliveryMode(agency: Pick<Agency, "storage">): DeliveryMode {
  return agency.storage.getSetting<{ mode: DeliveryMode }>("delivery")?.mode ?? "branch";
}

export function ship(
  agency: Agency,
  task: Task & { project: string },
  workspace: string,
  written: string[],
): string | undefined {
  const { storage, backups } = agency;
  const short = task.id.slice(0, 8);
  const shipment = { taskId: task.id, workspace, project: task.project };
  if (deliveryMode(agency) === "branch") {
    const onBranch = deliverToBranch(storage, { ...shipment, brief: task.brief }, written);
    if (onBranch) {
      if (onBranch.files.length === 0) return undefined;
      const { branch, files } = onBranch;
      return `Committed ${files.length} files to the branch ${branch} in ${task.project}: ${files.join(", ")}. Your working tree is unchanged. Review it with: git diff HEAD...${branch}; merge it with: git merge ${branch}; or drop it with: amora undo ${short}`;
    }
  }
  const delivered = deliverTracked(storage, { ...shipment, backups }, written);
  if (delivered.length === 0) return undefined;
  return `Wrote ${delivered.length} files to ${task.project}: ${delivered.join(", ")}. Replaced files were backed up; undo with: amora undo ${short}`;
}
