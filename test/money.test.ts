import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatUsd } from "../src/runtime/money.ts";

describe("dollar amounts", () => {
  it("shows ordinary amounts to the cent", () => {
    assert.deepEqual([0, 0.01, 0.5, 1, 12.345].map(formatUsd), [
      "$0.00",
      "$0.01",
      "$0.50",
      "$1.00",
      "$12.35",
    ]);
  });

  it("keeps an amount below one cent visible instead of rounding it to $0.00", () => {
    assert.deepEqual([0.005, 0.001, 0.0084, 0.00042, 1e-7].map(formatUsd), [
      "$0.005",
      "$0.001",
      "$0.0084",
      "$0.00042",
      "$0.0000001",
    ]);
  });
});
