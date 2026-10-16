import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";
import { saveProbeResults } from "../src/model-layer/known-models.ts";
import { scheduleReprobes } from "../src/model-layer/reprobe.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { openStorage, type Storage } from "../src/runtime/storage.ts";
import { dayMs } from "../src/runtime/time.ts";

const start = Date.parse("2026-10-01T00:00:00Z");
const results = [
  { capability: "structured_output" as const, result: "json_schema", detail: "old" },
  { capability: "tool_use" as const, result: "true", detail: "old" },
  { capability: "vision" as const, result: "false", detail: "old" },
  { capability: "context" as const, result: "1000", detail: "old" },
];

// Stands in for the gateway: stores fresh results, dated by the (mocked) clock.
function measureInto(storage: Storage) {
  return async (model: string) => saveProbeResults(storage, model, results);
}

// Lets the check that a tick started finish before the next assertion.
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function days(count: number): Promise<void> {
  for (let day = 0; day < count; day += 1) {
    mock.timers.tick(dayMs);
    await settle();
  }
}

function setup(models: string[]) {
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
  for (const model of models) saveProbeResults(storage, model, results, new Date(start));
  storage.setSetting("slots", { divisions: {}, workers: {}, global: models[0] });
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  return { storage, logger, lines };
}

const reprobedOn = (lines: string[]) =>
  lines
    .map((line) => JSON.parse(line) as { time: string; message: string })
    .filter((entry) => entry.message === "Model re-probed")
    .map((entry) => Math.round((Date.parse(entry.time) - start) / dayMs));

describe("the daily re-probe schedule, over simulated time", () => {
  afterEach(() => mock.timers.reset());

  it("measures a model again the day its probe passes seven days, then waits another seven", async () => {
    const { storage, logger, lines } = setup(["a/model"]);
    mock.timers.enable({ apis: ["setInterval", "Date"], now: start + dayMs });
    const stop = scheduleReprobes({
      storage,
      measure: measureInto(storage),
      logger,
    });
    await settle();
    assert.deepEqual(reprobedOn(lines), []);
    await days(16);
    stop();
    // Day 7 is exactly seven days old, which is not yet older than seven.
    assert.deepEqual(reprobedOn(lines), [8, 16]);
  });

  it("keeps its schedule after a failed measurement", async () => {
    const { storage, logger, lines } = setup(["a/model"]);
    mock.timers.enable({ apis: ["setInterval", "Date"], now: start + 8 * dayMs });
    let calls = 0;
    const measure = async (model: string) => {
      calls += 1;
      if (calls === 1) throw new Error("keychain locked");
      await measureInto(storage)(model);
    };
    const stop = scheduleReprobes({ storage, measure, logger });
    await settle();
    await days(1);
    stop();
    assert.match(lines.join(""), /Model re-probe skipped.*keychain locked/);
    // Day 8 fails; the next daily check, on day 9, measures it.
    assert.deepEqual(reprobedOn(lines), [9]);
  });

  it("reports a gateway that is not connected, and stops when told to", async () => {
    const { storage, logger, lines } = setup(["a/model"]);
    mock.timers.enable({ apis: ["setInterval", "Date"], now: start + 9 * dayMs });
    let checks = 0;
    const measure = async () => {
      checks += 1;
      throw new Error("Connect OpenRouter first");
    };
    const stop = scheduleReprobes({ storage, measure, logger });
    await settle();
    await days(2);
    assert.equal(checks, 3);
    stop();
    await days(3);
    assert.equal(checks, 3);
    assert.deepEqual(reprobedOn(lines), []);
    assert.match(lines.join(""), /Connect OpenRouter first/);
  });

  it("picks up a model assigned from another terminal while it runs", async () => {
    const { storage, logger, lines } = setup(["a/first"]);
    saveProbeResults(storage, "b/second", results, new Date(start));
    mock.timers.enable({ apis: ["setInterval", "Date"], now: start + 9 * dayMs });
    const stop = scheduleReprobes({
      storage,
      measure: measureInto(storage),
      logger,
    });
    await settle();
    assert.equal(reprobedOn(lines).length, 1);
    storage.setSetting("slots", {
      divisions: { forge: "b/second" },
      workers: {},
      global: "a/first",
    });
    await days(1);
    stop();
    assert.equal(reprobedOn(lines).length, 2);
  });
});
