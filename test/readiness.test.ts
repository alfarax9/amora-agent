import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptySlots } from "../src/model-layer/slots.ts";
import { readinessGaps } from "../src/runtime/readiness.ts";
import { setup } from "./agency.ts";

describe("readiness for a new task", () => {
  it("names the command for each missing piece, and nothing once all are set", () => {
    const { agency } = setup({});
    const unassigned = { ...agency, slots: () => emptySlots };
    assert.deepEqual(
      readinessGaps(unassigned, undefined).map(({ command }) => command),
      ["amora models set global <model>", "amora budget --daily <usd>", "amora project <path>"],
    );
    const unprobed = { ...agency, lookup: () => undefined };
    assert.deepEqual(
      readinessGaps(unprobed, "/tmp/project")[0]?.command,
      "amora models probe fake/alpha",
    );
    agency.storage.setSetting("budgets", { dailyUsd: 1 });
    assert.deepEqual(readinessGaps(agency, "/tmp/project"), []);
  });
});
