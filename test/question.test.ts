import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isQuestion } from "../src/runtime/question.ts";
import { getTask, listHandoffs, listMessages } from "../src/runtime/task-store.ts";
import { manifest, setup } from "./agency.ts";

describe("questions", () => {
  it("tells a question from a request for work, in English and Indonesian", () => {
    const questions = [
      "what is modeling ai ??",
      "Why does the login page reload?",
      "How do I add a page?",
      "apa itu agent harness",
      "kenapa tombol login tidak jalan?",
    ];
    const work = [
      "Add a pricing section to the landing page.",
      "Can you add a dark mode toggle?",
      "tolong perbaiki tombol login",
      "buatkan halaman login",
      "test",
    ];
    assert.deepEqual(questions.filter(isQuestion), questions);
    assert.deepEqual(work.filter(isQuestion), []);
  });

  it("answers a question in one call, without a plan or a project, and ends the task", async () => {
    const assistant = manifest("assistant", { output_contract: "answer.v1" });
    const world = setup(
      { answer_v1: [{ answer: "Modeling means fitting a model to data." }] },
      { extra: [assistant], dailyUsd: 1, costPerCall: 0.001 },
    );
    const task = await world.orchestrator.submit("what is modeling ai ??", 1);
    assert.equal(task.status, "completed");
    assert.equal(getTask(world.storage, task.id)?.project, undefined);
    assert.deepEqual(
      listMessages(world.storage, task.id).map(({ author, text }) => [author, text]),
      [
        ["owner", "what is modeling ai ??"],
        ["agency", "Modeling means fitting a model to data."],
      ],
    );
    assert.deepEqual(
      listHandoffs(world.storage, task.id).map(({ sender }) => sender),
      ["assistant"],
    );
    assert.equal(world.requests.length, 1);
    assert.ok(task.spentUsd > 0);
  });
});
