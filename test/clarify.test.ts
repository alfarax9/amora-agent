import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plan, setup } from "./agency.ts";

describe("the Planner's question", () => {
  it("waits for the owner's answer instead of a plan, then plans with it", async () => {
    const question = { text: "Which kind of shop?", choices: ["Books", "Clothes"] };
    const world = setup(
      {
        plan_v1: [{ summary: "I need to know the shop.", steps: [], question }, plan(["builder"])],
      },
      { dailyUsd: 1 },
    );
    const asked = await world.orchestrator.submit("Build me a shop", 1);
    assert.equal(asked.status, "awaiting_plan_approval");
    assert.deepEqual(asked.plan?.question, question);
    assert.deepEqual(asked.plan?.steps, []);
    await assert.rejects(world.orchestrator.approve(asked.id), /Answer the Planner's question/);
    const planned = await world.orchestrator.revise(asked.id, "Books");
    assert.equal(planned.status, "awaiting_plan_approval");
    assert.equal(planned.plan?.question, null);
    assert.deepEqual(
      planned.plan?.steps.map(({ worker }) => worker),
      ["builder"],
    );
    const input = JSON.parse(String(world.requests.at(-1)?.messages[1]?.content)) as {
      feedback: string[];
    };
    assert.deepEqual(input.feedback, ["Books"]);
  });
});
