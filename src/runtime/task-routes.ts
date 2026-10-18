import type { IncomingMessage } from "node:http";
import type { Decision, Orchestrator } from "./orchestrator.ts";
import { Refusal } from "./orchestrator.ts";
import { findSecrets } from "./secret-scanner.ts";
import type { Storage } from "./storage.ts";
import { listHandoffs, listMessages, listTasks, spentSince, type Task } from "./task-store.ts";

// The agency chat's API: briefs become tasks, and the owner approves, revises,
// retries, completes, or cancels them (PRD §8). Every action answers at once;
// the work runs in the background and the page polls for it.

export type TaskDesk = {
  orchestrator: Orchestrator;
  storage: Storage;
  // Worker ids to roles, so the page can say who does each step.
  roles: Record<string, string>;
  // The folder new tasks work on, set with amora project.
  project(): string | undefined;
};

export type JsonReply = { status: number; body: Record<string, unknown> };

class BadRequest extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const maxBodyBytes = 64 * 1024;

// Only JSON is accepted, so a plain HTML form on another site cannot post here
// even before the Origin check (S3) refuses it.
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(request.headers["content-type"]).startsWith("application/json")) {
    throw new BadRequest(415, "Send JSON.");
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBodyBytes) throw new BadRequest(413, "That message is too long.");
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  } catch {
    // Answered below like any other body that is not an object.
  }
  throw new BadRequest(400, "The request body is not a JSON object.");
}

// Chat never accepts secrets (PRD §8 rule 5, S4). The message names the kind of
// key, never the key, and points to where keys belong.
function refuseKeys(text: string): string {
  const [found] = findSecrets(text);
  if (found) {
    throw new BadRequest(
      400,
      `That message looks like it contains a key (${found.name}), so it was not sent. Keys never go through chat: connect gateways from this page or with amora connect.`,
    );
  }
  return text;
}

function text(body: Record<string, unknown>, field: string, missing: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") throw new BadRequest(400, missing);
  return refuseKeys(value.trim());
}

function amount(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new BadRequest(400, `The ${field} must be an amount in USD above 0.`);
  }
  return value;
}

function decision(body: Record<string, unknown>): Decision {
  if (body.action === "retry") {
    const budgetUsd = amount(body, "budgetUsd");
    return budgetUsd === undefined ? { action: "retry" } : { action: "retry", budgetUsd };
  }
  if (body.action === "complete" || body.action === "cancel") return { action: body.action };
  throw new BadRequest(400, "Choose retry, complete, or cancel.");
}

function thread(storage: Storage, task: Task) {
  return {
    ...task,
    messages: listMessages(storage, task.id),
    handoffs: listHandoffs(storage, task.id),
  };
}

const recentTasks = 20;

function overview(desk: TaskDesk): JsonReply {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { storage } = desk;
  const tasks = listTasks(storage).slice(0, recentTasks).reverse();
  return {
    status: 200,
    body: {
      tasks: tasks.map((task) => thread(storage, task)),
      roles: desk.roles,
      project: desk.project() ?? null,
      paused: storage.getSetting<boolean>("paused") ?? false,
      dailyUsd: storage.getSetting<{ dailyUsd: number }>("budgets")?.dailyUsd ?? null,
      spentTodayUsd: spentSince(storage, today),
    },
  };
}

type Action = (desk: TaskDesk, id: string, body: Record<string, unknown>) => Task | Promise<Task>;

const taskActions: Record<string, Action> = {
  approve: ({ orchestrator }, id) => orchestrator.approve(id),
  revise: ({ orchestrator }, id, body) =>
    orchestrator.revise(id, text(body, "feedback", "Write what should change first.")),
  decide: ({ orchestrator }, id, body) => orchestrator.decide(id, decision(body)),
  cancel: ({ orchestrator }, id) => orchestrator.cancel(id),
};

const taskPath = /^\/api\/tasks\/([0-9a-f-]{36})\/([a-z]+)$/;

async function post(desk: TaskDesk, path: string, request: IncomingMessage) {
  if (path === "/api/pause") return (desk.orchestrator.pauseAll(), overview(desk));
  if (path === "/api/resume") return (desk.orchestrator.resumeAll(), overview(desk));
  const body = await readJson(request);
  if (path === "/api/tasks") {
    const brief = text(body, "brief", "Describe what the agency should build first.");
    const budgetUsd = amount(body, "budgetUsd");
    if (budgetUsd === undefined) throw new BadRequest(400, "Give the task a budget in USD.");
    const task = desk.orchestrator.create(brief, budgetUsd, desk.project());
    return { status: 201, body: { task } };
  }
  const [, id = "", name = ""] = taskPath.exec(path) ?? [];
  const action = taskActions[name];
  if (!action) return undefined;
  return { status: 200, body: { task: await action(desk, id, body) } };
}

// Answers a task API request, or nothing when the path is not one of these.
export async function handleTaskApi(
  desk: TaskDesk,
  request: IncomingMessage,
  path: string,
): Promise<JsonReply | undefined> {
  try {
    if (request.method === "GET" && path === "/api/tasks") return overview(desk);
    if (request.method === "POST") return await post(desk, path, request);
    return undefined;
  } catch (error) {
    if (error instanceof BadRequest)
      return { status: error.status, body: { error: error.message } };
    if (error instanceof Refusal) return { status: 409, body: { error: error.message } };
    throw error;
  }
}
