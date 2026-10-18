import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GatewayError } from "../src/model-layer/gateway.ts";
import {
  createTask,
  getTask,
  listHandoffs,
  listMessages,
  saveTask,
} from "../src/runtime/task-store.ts";
import { passing, plan, setup } from "./agency.ts";

const brief = "Add a pricing card to the landing page.";

async function planned(...args: Parameters<typeof setup>) {
  const world = setup(...args);
  const task = await world.orchestrator.submit(brief, 1);
  return { ...world, task };
}

describe("orchestrator: background work and the transcript", () => {
  it("answers an approval at once and finishes the work in the background", async () => {
    const { runtime, storage, task } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }], review_v1: [passing] },
      { dailyUsd: 5 },
    );
    assert.equal((await runtime.approve(task.id)).status, "running");
    await runtime.settled(task.id);
    assert.equal(getTask(storage, task.id)?.status, "awaiting_decision");
  });

  it("picks the work up again when the owner retries after a failed call", async () => {
    const { runtime, storage, task } = await planned(
      {
        plan_v1: [plan(["builder"])],
        note_v1: [new Error("busy"), { text: "v" }],
        review_v1: [passing],
      },
      { dailyUsd: 5 },
    );
    await runtime.approve(task.id);
    await runtime.settled(task.id);
    runtime.decide(task.id, { action: "retry" });
    await runtime.settled(task.id);
    assert.match(getTask(storage, task.id)?.reason ?? "", /Every step passed/);
  });

  it("hands a task left running by an earlier process back to the owner", () => {
    const { runtime, storage } = setup({});
    const stranded = saveTask(storage, {
      ...createTask(storage, brief, 1),
      status: "running",
      plan: plan(["builder"]),
    });
    runtime.recoverInterrupted();
    const task = getTask(storage, stranded.id);
    assert.equal(task?.status, "awaiting_decision");
    assert.match(task?.reason ?? "", /AMORA stopped while this task was working/);
  });

  it("keeps what the owner asked and decided, and what the agency answered", async () => {
    const { orchestrator, storage, task } = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [{ text: "v" }], review_v1: [passing] },
      { dailyUsd: 5 },
    );
    await orchestrator.approve(task.id);
    await orchestrator.decide(task.id, { action: "cancel" });
    assert.deepEqual(
      listMessages(storage, task.id).map(({ author, text }) => `${author}: ${text}`),
      [
        `owner: ${brief}`,
        "agency: The plan is ready for your approval.",
        "owner: Approved the plan.",
        "agency: Every step passed its gate. Approve to complete the task.",
        "owner: Cancel the task.",
        "agency: The task was cancelled.",
      ],
    );
  });
});

describe("orchestrator: a gate check that cannot finish", () => {
  it("takes the step's files back out of the workspace when a reviewer fails mid-gate", async () => {
    const project = mkdtempSync(join(tmpdir(), "amora-project-"));
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "package.json"), "{}");
    const files = [{ path: "src/new.js", content: "export const a = 1;\n" }];
    const world = setup(
      {
        plan_v1: [plan(["builder"])],
        code_change_v1: [{ summary: "Adds a.", files, notes: [] }],
        review_v1: [new Error("No answer within 300 s.")],
      },
      {
        dailyUsd: 5,
        builder: {
          output_contract: "code_change.v1",
          plugins: [{ filesystem: { scope: "src/**" } }],
          quality_gate: ["schema_valid", "files_in_scope", { reviewed_by: "checker" }],
        },
      },
    );
    const { id } = world.runtime.create(brief, 1, project);
    await world.runtime.settled(id);
    await world.runtime.approve(id);
    await world.runtime.settled(id);
    assert.match(
      getTask(world.storage, id)?.reason ?? "",
      /could not finish: No answer within 300 s/,
    );
    const workspace = join(world.agency.workspaces, id);
    assert.ok(existsSync(join(workspace, "package.json")));
    assert.ok(!existsSync(join(workspace, "src", "new.js")), "the unrecorded file was left behind");
    assert.equal(
      listHandoffs(world.storage, id).filter(({ sender }) => sender === "builder").length,
      0,
    );
  });
});

describe("orchestrator: what a step's worker is told", () => {
  it("gives each worker its area and what later steps will deliver", async () => {
    const world = await planned(
      { plan_v1: [plan(["builder", "builder"])], note_v1: [{ text: "v" }], review_v1: [passing] },
      { dailyUsd: 5, builder: { plugins: [{ filesystem: { scope: "src/**" } }] } },
    );
    await world.orchestrator.approve(world.task.id);
    const builderInputs = world.requests
      .filter((request) => request.model === "fake/alpha" && request.response_format)
      .map((request) => String(request.messages[1]?.content))
      .filter((content) => content.includes('"goal"') && !content.includes('"reviewing"'));
    const first = JSON.parse(builderInputs[0] ?? "{}") as { area: string[]; later: unknown[] };
    assert.deepEqual(first.area, ["src/**"]);
    assert.deepEqual(first.later, [{ worker: "Role builder", goal: "Goal for builder" }]);
    const second = JSON.parse(builderInputs.at(-1) ?? "{}") as { later: unknown[] };
    assert.deepEqual(second.later, []);
  });
});

describe("orchestrator: busy providers during a task", () => {
  it("tries a worker's call again after a provider error instead of stopping the task", async () => {
    const providerError = new GatewayError(500, "Provider returned error from Nvidia");
    const world = await planned(
      {
        plan_v1: [plan(["builder"])],
        note_v1: [{ text: "v" }],
        review_v1: [providerError, passing],
      },
      { dailyUsd: 5 },
    );
    const finished = await world.orchestrator.approve(world.task.id);
    assert.match(finished.reason ?? "", /Every step passed/);
  });

  it("still stops on an error that says nothing will change, without retrying", async () => {
    const world = await planned(
      { plan_v1: [plan(["builder"])], note_v1: [new GatewayError(402, "No credits")] },
      { dailyUsd: 5 },
    );
    const stopped = await world.orchestrator.approve(world.task.id);
    assert.match(stopped.reason ?? "", /could not finish: No credits/);
    assert.equal(world.requests.filter((request) => request.model === "fake/alpha").length, 2);
  });
});
