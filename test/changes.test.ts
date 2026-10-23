import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Chat, ChatRequest } from "../src/model-layer/gateway.ts";
import type { Agency } from "../src/runtime/agency.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { createOrchestrator } from "../src/runtime/orchestrator.ts";
import { handleTaskApi } from "../src/runtime/task-routes.ts";
import { getTask } from "../src/runtime/task-store.ts";
import { openWorkspace } from "../src/runtime/workspace.ts";
import { briefOf, fakeAgency, taxSolution } from "./eval-fixture.ts";

// The tax brief through the Small team on a copy of the cart project, with
// every request kept; the project already has an old src/tax.js.
async function finished(review?: unknown) {
  const project = join(mkdtempSync(join(tmpdir(), "amora-review-")), "cart");
  openWorkspace(briefOf("tax").project, project);
  writeFileSync(join(project, "src", "tax.js"), "export const old = 1;\n");
  const base = fakeAgency(taxSolution, review);
  const requests: ChatRequest[] = [];
  const agency: Agency = {
    ...base,
    roster: () => ({ offered: ["software-engineer", "unit-integration-tester"] }),
    connect: async (model) => {
      const connected = await base.connect(model);
      const chat: Chat = (request) => (requests.push(request), connected.chat(request));
      return { ...connected, chat };
    },
  };
  const orchestrator = createOrchestrator(agency, { logger: createLogger(() => undefined) });
  const { id } = orchestrator.create(briefOf("tax").brief, 1, project);
  await orchestrator.settled(id);
  await orchestrator.approve(id);
  await orchestrator.settled(id);
  return { orchestrator, agency, requests, id };
}

const engineerAsked = (requests: ChatRequest[]) =>
  requests.filter((request) =>
    String(request.messages[0]?.content).startsWith("You are the Software Engineer"),
  );

describe("reviewing the changes before Complete", () => {
  it("shows each file as it would change the project", async () => {
    const { orchestrator, agency, id } = await finished();
    assert.match(getTask(agency.storage, id)?.reason ?? "", /Every step passed/);
    const changes = orchestrator.changes(id);
    assert.deepEqual(
      changes.map(({ path, status }) => [path, status]),
      [
        ["src/tax.js", "modified"],
        ["tests/tax.test.js", "added"],
      ],
    );
    const [tax] = changes;
    assert.match(tax?.diff ?? "", /^@@/);
    assert.match(tax?.diff ?? "", /^-export const old = 1;$/m);
    assert.match(tax?.diff ?? "", /^\+export function totalWithTax/m);
  });

  it("sends a note back to the step that wrote the file, and the steps after it run again", async () => {
    const { orchestrator, agency, requests, id } = await finished();
    const before = engineerAsked(requests).length;
    orchestrator.decide(id, {
      action: "changes",
      notes: [{ file: "src/tax.js", text: "Round each line, not the total." }],
    });
    await orchestrator.settled(id);
    const asked = engineerAsked(requests);
    assert.equal(asked.length, before + 1);
    assert.match(
      String(asked.at(-1)?.messages[1]?.content),
      /src\/tax\.js: Round each line, not the total\./,
    );
    assert.match(getTask(agency.storage, id)?.reason ?? "", /Every step passed/);
  });

  it("refuses notes before every step passed, and an empty set of notes", async () => {
    const done = await finished();
    assert.throws(
      () => done.orchestrator.decide(done.id, { action: "changes", notes: [] }),
      /Write a note on at least one file first/,
    );
    const stopped = await finished({ verdict: "fail", findings: ["Not good enough."] });
    assert.match(
      getTask(stopped.agency.storage, stopped.id)?.reason ?? "",
      /did not pass its gate/,
    );
    assert.throws(
      () =>
        stopped.orchestrator.decide(stopped.id, {
          action: "changes",
          notes: [{ file: "src/tax.js", text: "x" }],
        }),
      /once every step passed its gate/,
    );
    assert.deepEqual(stopped.orchestrator.changes(stopped.id), []);
  });

  it("never shows a key the work holds", async () => {
    const { orchestrator, agency, id } = await finished();
    const key = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;
    const file = join(agency.workspaces, id, "src", "tax.js");
    writeFileSync(file, `${readFileSync(file, "utf8")}// ${key}\n`);
    const [tax] = orchestrator.changes(id);
    assert.ok(!(tax?.diff ?? "").includes(key));
    assert.match(tax?.diff ?? "", /\[redacted /);
  });

  it("sends the changes with a task that is ready to complete", async () => {
    const { orchestrator, agency } = await finished();
    const desk = {
      orchestrator,
      storage: agency.storage,
      roles: {},
      divisions: {},
      readiness: () => [],
      project: () => undefined,
    };
    const request = { method: "GET", headers: {} } as IncomingMessage;
    const reply = await handleTaskApi(desk, request, "/api/tasks");
    const [task] = (reply?.body.tasks ?? []) as { changes: { path: string }[] }[];
    assert.deepEqual(
      task?.changes.map(({ path }) => path),
      ["src/tax.js", "tests/tax.test.js"],
    );
  });
});
