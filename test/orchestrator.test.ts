import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Refusal } from "../src/runtime/orchestrator.ts";
import { assertMove, canMove } from "../src/runtime/task-states.ts";
import { getTask, listHandoffs } from "../src/runtime/task-store.ts";
import { failing, passing, plan, setup } from "./agency.ts";

const brief = "Add a pricing card to the landing page.";

async function planned(...args: Parameters<typeof setup>) {
  const world = setup(...args);
  const task = await world.orchestrator.submit(brief, 1);
  return { ...world, task };
}

describe("task states", () => {
  it("allows only the listed moves", () => {
    assert.ok(canMove("planning", "awaiting_plan_approval"));
    assert.ok(!canMove("planning", "running"));
    assert.throws(() => assertMove("completed", "running"), /cannot go from completed to running/);
  });
});

describe("orchestrator: the thin path from brief to completed task", () => {
  it("plans, waits for approval, runs the step through its gate, and completes", async () => {
    const { orchestrator, storage, task } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "done" }], review_v1: [passing] },
      { dailyUsd: 5 },
    );
    assert.equal(task.status, "awaiting_plan_approval");
    assert.equal(task.plan?.steps[0]?.worker, "builder");
    const finished = await orchestrator.approve(task.id);
    assert.equal(finished.status, "awaiting_decision");
    assert.match(finished.reason ?? "", /Every step passed its gate/);
    assert.equal((await orchestrator.decide(task.id, { action: "complete" })).status, "completed");
    const log = listHandoffs(storage, task.id);
    assert.deepEqual(
      log.map((handoff) => [handoff.sender, handoff.receiver, handoff.gate]),
      [
        ["planner-decomposer", "owner", "passed"],
        ["builder", "owner", "passed"],
        ["checker", "builder", "passed"],
      ],
    );
    assert.equal(log[1]?.answeredBy, "answered-fake/alpha");
    assert.equal(log[2]?.model, "fake/beta");
  });

  it("refuses approval without a daily budget, or with an estimate above the task's budget", async () => {
    const unset = await planned({ plan_v1: [plan(["builder"])] });
    await assert.rejects(unset.orchestrator.approve(unset.task.id), Refusal);
    // One builder call and one review, 16,000 tokens each at $100 per million.
    const costly = await planned(
      { plan_v1: [plan(["builder"])] },
      { dailyUsd: 5, pricePerMillion: 100 },
    );
    assert.deepEqual(costly.task.plan?.estimate, { usd: 3.2, unpriced: [] });
    await assert.rejects(costly.orchestrator.approve(costly.task.id), /estimated at \$3.20/);
    assert.equal(getTask(costly.storage, costly.task.id)?.status, "awaiting_plan_approval");
  });

  it("computes the estimate in code and refuses a plan whose models have no known price", async () => {
    const world = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }] },
      { dailyUsd: 5 },
    );
    world.agency.price = async () => undefined;
    await assert.rejects(
      world.orchestrator.approve(world.task.id),
      /No price is known for fake\/alpha, fake\/beta, so the plan has no estimate. State each with: amora models price/,
    );
    world.agency.price = async () => ({ inputPerMillion: 0, outputPerMillion: 0 });
    assert.equal((await world.runtime.approve(world.task.id)).status, "running");
    assert.deepEqual(getTask(world.storage, world.task.id)?.plan?.estimate, {
      usd: 0,
      unpriced: [],
    });
  });

  it("sends a plan naming an unknown worker back to the Planner, then waits for the owner", async () => {
    const { task, requests } = await planned({ plan_v1: [plan(["ghost"])] });
    assert.equal(task.status, "awaiting_decision");
    assert.match(task.reason ?? "", /The plan is not ready/);
    assert.match(
      String(requests[1]?.messages.at(-1)?.content),
      /"ghost" is not one of the workers/,
    );
  });

  it("refuses a plan that runs a worker before anything delivers what it needs", async () => {
    const { task, requests } = await planned(
      { plan_v1: [plan(["builder"])] },
      { builderNeeds: "design_spec.v1" },
    );
    assert.equal(task.status, "awaiting_decision");
    assert.match(
      String(requests[1]?.messages.at(-1)?.content),
      /builder needs design_spec.v1, which no earlier step delivers/,
    );
  });

  it("offers the Planner what each worker needs and delivers, and no reviewers", async () => {
    const { requests } = await planned({ plan_v1: [plan(["builder"])] });
    const input = JSON.parse(String(requests[0]?.messages[1]?.content)) as {
      workers: { id: string; needs: string; delivers: string }[];
    };
    assert.deepEqual(
      input.workers.map(({ id, needs, delivers }) => [id, needs, delivers]),
      [["builder", "brief.v1", "note.v1"]],
    );
  });

  it("marks an output fixed on the second try as repaired", async () => {
    const { orchestrator, storage, task } = await planned(
      {
        plan_v1: [plan(["builder"])],
        note_v1: ['{"txt": 1}', { text: "ok" }],
        review_v1: [passing],
      },
      { dailyUsd: 5 },
    );
    await orchestrator.approve(task.id);
    assert.equal(listHandoffs(storage, task.id)[1]?.validation, "repaired");
  });
});

describe("orchestrator: gates and attempts", () => {
  it("returns failed work with the findings and tries again", async () => {
    const { orchestrator, storage, task, requests } = await planned(
      {
        plan_v1: [plan(["builder"])],
        note_v1: [{ text: "v1" }, { text: "v2" }],
        review_v1: [failing("The price is missing."), passing],
      },
      { dailyUsd: 5 },
    );
    await orchestrator.approve(task.id);
    const builds = listHandoffs(storage, task.id).filter((handoff) => handoff.sender === "builder");
    assert.deepEqual(
      builds.map((handoff) => [handoff.attempt, handoff.gate]),
      [
        [1, "failed"],
        [2, "passed"],
      ],
    );
    const secondTry = requests.filter((request) => request.model === "fake/alpha")[2];
    assert.match(String(secondTry?.messages[1]?.content), /The price is missing/);
  });

  it("asks the owner after three failed attempts, and a retry starts over", async () => {
    const { orchestrator, task } = await planned(
      {
        plan_v1: [plan(["builder"])],
        note_v1: [{ text: "v" }],
        review_v1: [failing("a"), failing("b"), failing("c"), passing],
      },
      { dailyUsd: 5 },
    );
    const stuck = await orchestrator.approve(task.id);
    assert.equal(stuck.status, "awaiting_decision");
    assert.match(stuck.reason ?? "", /did not pass its gate after 3 attempts\. .*c/);
    const retried = await orchestrator.decide(task.id, { action: "retry" });
    assert.match(retried.reason ?? "", /Every step passed/);
  });

  it("blocks a reviewer marked ≠ that shares the worker's model family", async () => {
    const families = { "fake/alpha": "same", "fake/beta": "same" };
    const { orchestrator, task, requests } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }], review_v1: [passing] },
      { dailyUsd: 5, families },
    );
    const stopped = await orchestrator.approve(task.id);
    assert.match(stopped.reason ?? "", /must use a different model family .* both use same/);
    assert.ok(!requests.some((request) => request.model === "fake/beta"));
  });

  it("blocks a reviewer marked ≠ when a model family is unknown", async () => {
    const { orchestrator, task } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }] },
      { dailyUsd: 5, families: { "fake/alpha": "alpha" } },
    );
    const stopped = await orchestrator.approve(task.id);
    assert.match(stopped.reason ?? "", /model family of fake\/beta .* is unknown/);
  });

  it("blocks a gate check AMORA cannot run instead of passing it", async () => {
    const { orchestrator, task } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }] },
      { dailyUsd: 5, builderGate: ["schema_valid", { visual_diff_below: 0.03 }] },
    );
    const stopped = await orchestrator.approve(task.id);
    assert.equal(stopped.status, "awaiting_decision");
    assert.match(stopped.reason ?? "", /cannot run the check visual_diff_below yet/);
  });

  it("blocks project checks when the task has no project folder", async () => {
    const { orchestrator, task } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }] },
      { dailyUsd: 5, builderGate: ["schema_valid", "lint_and_typecheck_pass"] },
    );
    const stopped = await orchestrator.approve(task.id);
    assert.match(stopped.reason ?? "", /This task has no project folder: amora project <path>/);
  });
});

describe("orchestrator: budgets, pause, and failures", () => {
  it("stops at the task's budget before the next step", async () => {
    const { orchestrator, storage, task } = await planned(
      {
        plan_v1: [plan(["builder", "builder"])],
        note_v1: [{ text: "v" }],
        review_v1: [passing],
      },
      { dailyUsd: 50, costPerCall: 0.4 },
    );
    const stopped = await orchestrator.approve(task.id);
    assert.match(stopped.reason ?? "", /reached its budget of \$1.00/);
    assert.equal(stopped.step, 1);
    assert.equal(listHandoffs(storage, task.id).filter((h) => h.sender === "builder").length, 1);
  });

  it("stops when today's spend across tasks reaches the daily limit", async () => {
    const { orchestrator, task } = await planned(
      {
        plan_v1: [plan(["builder", "builder"])],
        note_v1: [{ text: "v" }],
        review_v1: [passing],
      },
      { dailyUsd: 0.5, costPerCall: 0.2 },
    );
    const stopped = await orchestrator.approve(task.id);
    assert.match(stopped.reason ?? "", /daily limit of \$0.50/);
  });

  it("pauses before dispatching and carries on after resume", async () => {
    const { orchestrator, storage, task } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }], review_v1: [passing] },
      { dailyUsd: 5 },
    );
    orchestrator.pauseAll();
    assert.equal((await orchestrator.approve(task.id)).status, "paused");
    await orchestrator.resumeAll();
    assert.match(getTask(storage, task.id)?.reason ?? "", /Every step passed/);
  });

  it("waits for the owner when a model cannot be reached", async () => {
    const { orchestrator, task } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [new Error("No answer within 120 s.")] },
      { dailyUsd: 5 },
    );
    const stopped = await orchestrator.approve(task.id);
    assert.equal(stopped.status, "awaiting_decision");
    assert.match(stopped.reason ?? "", /could not finish: No answer within 120 s/);
  });

  it("never stores a secret from a brief or a model's output (S6)", async () => {
    const key = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;
    const world = setup(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: key }] },
      { dailyUsd: 5 },
    );
    assert.throws(
      () => world.orchestrator.create(`use ${key}`, 1),
      /Refusing to store a OpenRouter key/,
    );
    const task = await world.orchestrator.submit(brief, 1);
    const stopped = await world.orchestrator.approve(task.id);
    assert.match(stopped.reason ?? "", /Refusing to store a OpenRouter key/);
    assert.ok(!JSON.stringify(listHandoffs(world.storage, task.id)).includes(key));
  });

  it("cancels a waiting task and refuses to cancel a finished one", async () => {
    const { orchestrator, task } = await planned({ plan_v1: [plan(["builder"])] });
    assert.equal(orchestrator.cancel(task.id).status, "cancelled");
    assert.throws(() => orchestrator.cancel(task.id), /already finished/);
  });
});
