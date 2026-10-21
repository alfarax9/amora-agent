import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createConnectFlows } from "../src/runtime/connect.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { memoryStore } from "../src/runtime/secrets.ts";
import { createSessions } from "../src/runtime/security.ts";
import { startRuntime, type Runtime } from "../src/runtime/server.ts";
import { openStorage } from "../src/runtime/storage.ts";
import { openRouterKey, seedReports } from "./report-fixture.ts";

type Reply = { status: number; body: string; cookie: string };

function call(
  port: number,
  path: string,
  options: { cookie?: string; method?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers = {
    host: `127.0.0.1:${port}`,
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...options.headers,
  };
  const method = options.method ?? "GET";
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method, headers }, (incoming) => {
      let body = "";
      incoming.on("data", (chunk) => (body += chunk));
      incoming.on("end", () => {
        const cookie = String(incoming.headers["set-cookie"]).split(";")[0] ?? "";
        resolve({ status: incoming.statusCode ?? 0, body, cookie });
      });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function only<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

type Worker = Record<string, unknown> & { handoffs: Record<string, unknown>[] };
type Workers = { divisions: { division: string; workers: Worker[] }[] };
type Models = { gateways: Record<string, unknown>[]; models: Record<string, unknown>[] };
type Member = { model: string; probes: unknown[] };
type Costs = {
  dailyUsd: number;
  days: { usd: number }[];
  workers: { worker: string }[];
  models: Record<string, unknown>[];
  perTask: Record<string, unknown>;
};

describe("Workers, Models, and Costs API", () => {
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
  const secrets = memoryStore();
  const sessions = createSessions();
  let runtime: Runtime;
  let cookie = "";
  let taskId = "";

  before(async () => {
    const seeded = await seedReports(storage, secrets);
    taskId = seeded.taskId;
    runtime = await startRuntime(40000 + Math.floor(Math.random() * 10000), {
      sessions,
      flows: createConnectFlows(),
      secrets,
      logger: createLogger(() => undefined),
      reports: seeded.desk,
    });
    const token = new URL(runtime.signInUrl()).searchParams.get("token") ?? "";
    cookie = (await call(runtime.port, `/auth/sign-in?token=${token}`)).cookie;
  });
  after(async () => {
    await runtime.close();
    storage.close();
  });

  const read = async <T>(path: string): Promise<T> => {
    const reply = await call(runtime.port, path, { cookie });
    assert.equal(reply.status, 200);
    return JSON.parse(reply.body) as T;
  };

  it("needs a session and this origin, and only reads", async () => {
    const origin = `http://127.0.0.1:${runtime.port}`;
    for (const path of ["/api/workers", "/api/models", "/api/costs"]) {
      assert.equal((await call(runtime.port, path)).status, 401);
      const foreign = { cookie, headers: { origin: "https://evil.example" } };
      assert.equal((await call(runtime.port, path, foreign)).status, 403);
      const posted = { cookie, method: "POST", headers: { origin } };
      assert.equal((await call(runtime.port, path, posted)).status, 404);
    }
  });

  it("lists the workers by division with the model each slot resolves to", async () => {
    const { divisions } = await read<Workers>("/api/workers");
    assert.deepEqual(
      divisions.map(({ division }) => division),
      ["forge", "crucible", "nexus"],
    );
    const [builder, reviewer, planner] = divisions.map(({ workers }) => only(workers[0]));
    const resolved = (worker: Worker | undefined) => {
      const { model, level, verdict } = only(worker);
      return [model, level, verdict];
    };
    assert.deepEqual(resolved(builder), ["openrouter/a", "global", "rejected"]);
    assert.deepEqual(resolved(reviewer), ["omniroute/combo", "division", "unprobed"]);
    assert.deepEqual(resolved(planner), ["openrouter/listed", "worker", "fits"]);
    assert.deepEqual(only(builder).checks, [
      { code: "V", name: "Vision", met: false },
      { code: "T", name: "Tool use", met: true },
      { code: "LC", name: "Context of 64,000 tokens", met: true },
    ]);
    assert.deepEqual(only(reviewer).checks, [
      { code: "S", name: "Strict JSON schema", met: null },
      {
        code: "≠",
        name: "Different model family from the work it reviews",
        met: false,
        detail: "The model's family is unknown.",
      },
    ]);
  });

  it("shows each worker's latest five handoffs, newest first, with the gate's reason", async () => {
    const { divisions } = await read<Workers>("/api/workers");
    const { handoffs } = only(only(divisions[0]).workers[0]);
    assert.equal(handoffs.length, 5);
    const { gate, gateReason, task, taskId: id } = only(handoffs[0]);
    assert.deepEqual(
      [gate, gateReason, task, id],
      ["failed", "Visual diff 4.2%, limit 3%", "Build the pricing card", taskId],
    );
  });

  it("masks gateway keys to the last four and reports probes, combos, and prices", async () => {
    const reply = await call(runtime.port, "/api/models", { cookie });
    assert.ok(!reply.body.includes(openRouterKey));
    const { gateways, models } = JSON.parse(reply.body) as Models;
    assert.deepEqual(gateways[0], { name: "OpenRouter", key: `••••${openRouterKey.slice(-4)}` });
    assert.equal(only(gateways[1]).key, null);
    const byName = new Map(models.map((model) => [model.model, model]));
    const probed = only(byName.get("openrouter/a"));
    assert.deepEqual(probed.assignedTo, ["Global default"]);
    assert.equal((probed.probes as unknown[]).length, 4);
    assert.deepEqual([probed.stale, probed.price], [false, null]);
    const combo = only(byName.get("omniroute/combo"));
    assert.deepEqual([combo.assignedTo, combo.capabilities], [["Division crucible"], null]);
    const { members } = combo.combo as { members: Member[] };
    assert.deepEqual(
      members.map(({ model, probes }) => [model, probes.length]),
      [
        ["omniroute/m1", 4],
        ["omniroute/m2", 0],
      ],
    );
    const listed = only(byName.get("openrouter/listed"));
    assert.deepEqual(listed.assignedTo, ["Planner"]);
    assert.equal((listed.registry as { baseFamily: string }).baseFamily, "claude");
    assert.deepEqual(listed.price, { inputPerMillion: 1, outputPerMillion: 2 });
  });

  it("sums spend per day, worker, and model, with estimates where no cost was reported", async () => {
    const costs = await read<Costs>("/api/costs");
    assert.equal(costs.dailyUsd, 0.5);
    const total = costs.days.reduce((sum, day) => sum + day.usd, 0);
    assert.ok(Math.abs(total - 1.6) < 1e-9);
    assert.deepEqual(
      costs.workers.map(({ worker }) => worker),
      ["builder", "reviewer"],
    );
    const model = (name: string) => only(costs.models.find((row) => row.model === name));
    const combo = model("omniroute/combo");
    assert.deepEqual([combo.usd, combo.unreported, combo.estimatedUsd], [0, 1, 2]);
    assert.equal(model("openrouter/a").estimatedUsd, null);
    const { completed, tasks, averageUsd, estimatedAverageUsd } = costs.perTask;
    assert.deepEqual([completed, tasks, averageUsd, estimatedAverageUsd], [1, 2, 0.6, 0.4]);
  });
});
