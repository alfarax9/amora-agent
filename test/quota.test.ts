import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCaller, GatewayError } from "../src/model-layer/gateway.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { createOrchestrator } from "../src/runtime/orchestrator.ts";
import { defaultQuotaWaitMs, quotaWaitMs } from "../src/runtime/quota.ts";
import { getTask, listMessages, saveTask } from "../src/runtime/task-store.ts";
import { passing, plan, setup } from "./agency.ts";

const brief = "Add a pricing card to the landing page.";
// Out of quota three times (the call and its two retries), then served again.
const outOfQuota = (waitMs = 30) => [
  ...Array.from({ length: 3 }, () => new GatewayError(429, "Rate limit exceeded", waitMs)),
  { text: "v" },
];

async function until(check: () => boolean, ms = 3000): Promise<void> {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("the condition did not come true in time");
}

describe("telling a quota stop from other errors", () => {
  it("waits as long as the provider says, from a header or the message", () => {
    assert.equal(quotaWaitMs(new GatewayError(429, "slow down", 4000)), 4000);
    assert.equal(quotaWaitMs(new GatewayError(429, "slow down")), defaultQuotaWaitMs);
    const antigravity = "[403]: Antigravity upstream error (403) (reset after 5m)";
    assert.equal(quotaWaitMs(new GatewayError(403, antigravity)), 300_000);
    assert.equal(quotaWaitMs(new GatewayError(503, "Quota resets in 2 hours")), 7_200_000);
    const exhausted = "All antigravity accounts have exhausted their quota";
    assert.equal(quotaWaitMs(new GatewayError(503, exhausted)), defaultQuotaWaitMs);
  });

  it("leaves missing credit, a refused key, and other errors to the owner", () => {
    for (const error of [
      new GatewayError(402, "Insufficient credits; quota reached"),
      new GatewayError(401, "Rate limit for this key"),
      new GatewayError(400, "Bad request"),
      new GatewayError(500, "Internal error"),
      new Error("Rate limit exceeded"),
    ]) {
      assert.equal(quotaWaitMs(error), undefined, error.message);
    }
  });

  it("reads OpenRouter's X-RateLimit-Reset when there is no Retry-After", async () => {
    const reset = Date.now() + 60_000;
    const call = createCaller({
      baseUrl: "https://example.test",
      apiKey: "k",
      fetchImpl: async () =>
        Response.json(
          { error: { message: "Rate limit exceeded: free-models-per-day" } },
          { status: 429, headers: { "X-RateLimit-Reset": String(reset) } },
        ),
    });
    const error = await call("/chat").catch((failure: unknown) => failure);
    assert.ok(error instanceof GatewayError);
    assert.ok((error.retryAfterMs ?? 0) > 55_000 && (error.retryAfterMs ?? 0) <= 60_000);
  });
});

describe("orchestrator: a provider out of quota", () => {
  const script = () => ({
    plan_v1: [plan(["builder"])],
    note_v1: outOfQuota(),
    review_v1: [passing],
  });

  it("pauses the task with the time it can go on, and goes on when resumed", async () => {
    const world = setup(script(), { dailyUsd: 5 });
    const task = await world.orchestrator.submit(brief, 1);
    const paused = await world.orchestrator.approve(task.id);
    assert.equal(paused.status, "paused");
    assert.match(paused.reason ?? "", /^Paused: the model is out of quota .*Resume the task after/);
    assert.ok(paused.resumeAt);
    assert.equal(paused.quotaWaits, 1);
    await world.orchestrator.resumeAll();
    const done = getTask(world.storage, task.id);
    assert.match(done?.reason ?? "", /Every step passed/);
    assert.equal(done?.resumeAt, undefined);
    assert.equal(done?.quotaWaits, 0);
  });

  it("resumes by itself once the quota should be back", async () => {
    const world = setup(script(), { dailyUsd: 5, autoResume: true });
    const task = await world.orchestrator.submit(brief, 1);
    const paused = await world.orchestrator.approve(task.id);
    assert.match(paused.reason ?? "", /AMORA resumes the task at .* by itself/);
    await until(() => /Every step passed/.test(getTask(world.storage, task.id)?.reason ?? ""));
    const said = listMessages(world.storage, task.id).map(({ text }) => text);
    assert.ok(said.includes("The quota should be back; the task resumes."));
  });

  it("keeps the owner's pause of every worker over its own wake", async () => {
    const world = setup(script(), { dailyUsd: 5, autoResume: true });
    const task = await world.orchestrator.submit(brief, 1);
    await world.orchestrator.approve(task.id);
    world.orchestrator.pauseAll();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const kept = getTask(world.storage, task.id);
    assert.equal(kept?.status, "paused");
    assert.match(kept?.reason ?? "", /^Paused: the model is out of quota/);
    const said = listMessages(world.storage, task.id).map(({ text }) => text);
    assert.ok(!said.includes("The quota should be back; the task resumes."));
  });

  it("pauses while planning too, and plans again when resumed", async () => {
    const world = setup({ plan_v1: [...outOfQuota().slice(0, 3), plan(["builder"])] });
    const task = await world.orchestrator.submit(brief, 1);
    assert.equal(task.status, "paused");
    await world.orchestrator.resumeAll();
    assert.equal(getTask(world.storage, task.id)?.status, "awaiting_plan_approval");
  });

  it("asks the owner after five waits in a row", async () => {
    const world = setup(script(), { dailyUsd: 5 });
    const task = await world.orchestrator.submit(brief, 1);
    saveTask(world.storage, { ...task, quotaWaits: 5 });
    const stopped = await world.orchestrator.approve(task.id);
    assert.equal(stopped.status, "awaiting_decision");
    assert.match(stopped.reason ?? "", /stayed out of quota after 5 waits/);
  });

  it("sets the wake again after a restart, and resumes a task whose time has come", async () => {
    const world = setup(script(), { dailyUsd: 5 });
    const task = await world.orchestrator.submit(brief, 1);
    await world.orchestrator.approve(task.id);
    const restarted = createOrchestrator(world.agency, {
      logger: createLogger(() => undefined),
      autoResume: true,
    });
    restarted.recoverInterrupted();
    await until(() => /Every step passed/.test(getTask(world.storage, task.id)?.reason ?? ""));
  });
});
