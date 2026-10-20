import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, it } from "node:test";
import { createConnectFlows } from "../src/runtime/connect.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { memoryStore } from "../src/runtime/secrets.ts";
import { createSessions } from "../src/runtime/security.ts";
import { startRuntime, type Runtime } from "../src/runtime/server.ts";
import { listTasks } from "../src/runtime/task-store.ts";
import { passing, plan, setup } from "./agency.ts";

type Reply = { status: number; headers: Record<string, unknown>; body: string };

function call(
  port: number,
  method: string,
  path: string,
  options: { cookie?: string; json?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const body = options.json === undefined ? undefined : JSON.stringify(options.json);
  const headers: Record<string, string> = {
    host: `127.0.0.1:${port}`,
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...options.headers,
  };
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method, headers }, (incoming) => {
      let text = "";
      incoming.on("data", (chunk) => (text += chunk));
      incoming.on("end", () =>
        resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text }),
      );
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

type Thread = {
  id: string;
  status: string;
  reason?: string;
  messages: { author: string; text: string }[];
};

describe("agency chat API", () => {
  const world = setup({
    plan_v1: [plan(["builder"])],
    note_v1: [{ text: "done" }],
    review_v1: [passing],
  });
  const sessions = createSessions();
  let runtime: Runtime;
  let cookie = "";
  const key = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;

  before(async () => {
    runtime = await startRuntime(40000 + Math.floor(Math.random() * 10000), {
      sessions,
      flows: createConnectFlows(),
      secrets: memoryStore(),
      logger: createLogger(() => undefined),
      tasks: {
        orchestrator: world.runtime,
        storage: world.storage,
        roles: { builder: "Builder" },
        project: () => undefined,
      },
    });
    const token = new URL(runtime.signInUrl()).searchParams.get("token") ?? "";
    const signIn = await call(runtime.port, "GET", `/auth/sign-in?token=${token}`);
    cookie = String(signIn.headers["set-cookie"]).split(";")[0] ?? "";
  });
  after(() => runtime.close());

  const threads = async () =>
    (
      JSON.parse((await call(runtime.port, "GET", "/api/tasks", { cookie })).body) as {
        tasks: Thread[];
      }
    ).tasks;

  it("needs a session, JSON, and this origin", async () => {
    assert.equal((await call(runtime.port, "GET", "/api/tasks")).status, 401);
    const form = await call(runtime.port, "POST", "/api/tasks", {
      cookie,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(form.status, 415);
    const foreign = await call(runtime.port, "POST", "/api/tasks", {
      cookie,
      json: { brief: "x", budgetUsd: 1 },
      headers: { origin: "https://evil.example" },
    });
    assert.equal(foreign.status, 403);
  });

  it("checks review notes before they reach a task", async () => {
    const path = `/api/tasks/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/decide`;
    const none = await call(runtime.port, "POST", path, { cookie, json: { action: "changes" } });
    assert.equal(none.status, 400);
    assert.match(none.body, /Write between 1 and 50 notes/);
    const keyed = await call(runtime.port, "POST", path, {
      cookie,
      json: { action: "changes", notes: [{ file: "a.js", text: `use ${key}` }] },
    });
    assert.equal(keyed.status, 400);
    assert.ok(!keyed.body.includes(key));
  });

  it("refuses a message that holds a key, without echoing it or storing anything (PRD §8 rule 5)", async () => {
    const refused = await call(runtime.port, "POST", "/api/tasks", {
      cookie,
      json: { brief: `use ${key}`, budgetUsd: 1 },
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body, /looks like it contains a key \(OpenRouter key\)/);
    assert.ok(!refused.body.includes(key));
    assert.equal(listTasks(world.storage).length, 0);
  });

  it("turns a brief into a plan, then waits for approval with the transcript kept", async () => {
    const created = await call(runtime.port, "POST", "/api/tasks", {
      cookie,
      json: { brief: "Build a pricing card.", budgetUsd: 1 },
    });
    assert.equal(created.status, 201);
    const { task } = JSON.parse(created.body) as { task: Thread };
    await world.runtime.settled(task.id);
    const [thread] = await threads();
    assert.equal(thread?.status, "awaiting_plan_approval");
    assert.deepEqual(
      thread?.messages.map(({ author, text }) => [author, text]),
      [
        ["owner", "Build a pricing card."],
        ["agency", "The plan is ready for your approval."],
      ],
    );
  });

  it("refuses approval without a daily limit, then runs and completes the task", async () => {
    const [thread] = await threads();
    const id = thread?.id ?? "";
    const refused = await call(runtime.port, "POST", `/api/tasks/${id}/approve`, {
      cookie,
      json: {},
    });
    assert.equal(refused.status, 409);
    assert.match(refused.body, /Set a daily budget/);
    world.storage.setSetting("budgets", { dailyUsd: 5 });
    const approved = await call(runtime.port, "POST", `/api/tasks/${id}/approve`, {
      cookie,
      json: {},
    });
    assert.equal((JSON.parse(approved.body) as { task: Thread }).task.status, "running");
    await world.runtime.settled(id);
    const done = await call(runtime.port, "POST", `/api/tasks/${id}/decide`, {
      cookie,
      json: { action: "complete" },
    });
    assert.equal((JSON.parse(done.body) as { task: Thread }).task.status, "completed");
    const texts = (await threads())[0]?.messages.map(({ text }) => text) ?? [];
    assert.deepEqual(texts.slice(2), [
      "Approved the plan.",
      "Every step passed its gate. Approve to complete the task.",
      "Complete the task.",
      "The task is complete.",
    ]);
  });

  it("sends the owner's changes back to the Planner", async () => {
    const created = await call(runtime.port, "POST", "/api/tasks", {
      cookie,
      json: { brief: "Another card.", budgetUsd: 1 },
    });
    const { task } = JSON.parse(created.body) as { task: Thread };
    await world.runtime.settled(task.id);
    const empty = await call(runtime.port, "POST", `/api/tasks/${task.id}/revise`, {
      cookie,
      json: { feedback: " " },
    });
    assert.equal(empty.status, 400);
    await call(runtime.port, "POST", `/api/tasks/${task.id}/revise`, {
      cookie,
      json: { feedback: "Use two columns." },
    });
    await world.runtime.settled(task.id);
    const plannerInput = world.requests.filter((r) => r.model === "fake/alpha").at(-1)
      ?.messages[1]?.content;
    assert.match(String(plannerInput), /Use two columns/);
    const bad = await call(runtime.port, "POST", `/api/tasks/${task.id}/decide`, {
      cookie,
      json: { action: "explode" },
    });
    assert.equal(bad.status, 400);
  });

  it("pauses and resumes all workers", async () => {
    const paused = await call(runtime.port, "POST", "/api/pause", { cookie });
    assert.equal((JSON.parse(paused.body) as { paused: boolean }).paused, true);
    const resumed = await call(runtime.port, "POST", "/api/resume", { cookie });
    assert.equal((JSON.parse(resumed.body) as { paused: boolean }).paused, false);
  });

  it("serves the chat page with its own scripts only", async () => {
    const home = await call(runtime.port, "GET", "/", { cookie });
    const policy = String(home.headers["content-security-policy"]);
    assert.match(policy, /script-src 'self'; connect-src 'self'/);
    assert.match(home.body, /<script type="module" src="\/dashboard\/app.js">/);
    const script = await call(runtime.port, "GET", "/dashboard/app.js", { cookie });
    assert.equal(script.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal((await call(runtime.port, "GET", "/dashboard/other.js", { cookie })).status, 404);
    assert.equal((await call(runtime.port, "GET", "/dashboard/app.js")).status, 401);
  });

  it("never sets content through innerHTML in the dashboard scripts", async () => {
    for (const name of ["app.js", "render.js", "log.js", "dom.js"]) {
      const script = await call(runtime.port, "GET", `/dashboard/${name}`, { cookie });
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(script.body), name);
    }
  });
});
