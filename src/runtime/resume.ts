import { type Desk, drive, load, move, startWork } from "./dispatch.ts";
import type { Task } from "./task-store.ts";

// Resuming paused tasks: by the owner, or by themselves once a provider's quota
// is back (quota.ts). The orchestrator passes in how to plan, since a task
// paused while planning goes back to planning.

type Replan = (id: string) => Promise<unknown>;

export function resumeTask(desk: Desk, task: Task, replan: Replan, reason?: string): void {
  const resumed = { ...task };
  delete resumed.resumeAt;
  if (!task.plan) {
    move(desk, resumed, "planning", reason);
    return startWork(desk, task.id, () => replan(task.id));
  }
  move(desk, resumed, "running", reason);
  startWork(desk, task.id, () => drive(desk, task.id));
}

// A task that paused for quota resumes when the provider said it would serve
// again, unless the owner paused every worker meanwhile: that pause stands.
function wakeUp(desk: Desk, id: string, replan: Replan): void {
  const task = load(desk, id);
  if (task.status !== "paused" || !task.resumeAt) return;
  if (desk.agency.storage.getSetting<boolean>("paused")) return;
  resumeTask(desk, task, replan, "The quota should be back; the task resumes.");
}

// setTimeout holds at most about 24.8 days; a later wake is set again then.
const longestTimerMs = 2 ** 31 - 1;

export function wakeLater(desk: Desk, replan: Replan): (id: string, at: Date) => void {
  const timers = new Map<string, NodeJS.Timeout>();
  const wake = (id: string, at: Date) => {
    clearTimeout(timers.get(id));
    const delay = at.getTime() - desk.now().getTime();
    const timer = setTimeout(
      () => {
        timers.delete(id);
        if (delay > longestTimerMs) wake(id, at);
        else wakeUp(desk, id, replan);
      },
      Math.min(Math.max(0, delay), longestTimerMs),
    );
    timer.unref();
    timers.set(id, timer);
  };
  return wake;
}
