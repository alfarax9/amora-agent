import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createConnectFlows } from "../src/runtime/connect.ts";

const tenMinutes = 10 * 60 * 1000;

function startFlow(flows: ReturnType<typeof createConnectFlows>): string {
  const url = new URL(flows.start(4310));
  return url.searchParams.get("state") ?? "";
}

describe("connect flows", () => {
  it("lets a state finish once", () => {
    const flows = createConnectFlows();
    const state = startFlow(flows);
    assert.ok(flows.finish(state));
    assert.equal(flows.finish(state), undefined);
  });

  it("forgets a state that waited longer than OpenRouter's codes live", () => {
    let now = 0;
    const flows = createConnectFlows(() => now);
    const state = startFlow(flows);
    now = tenMinutes + 1;
    assert.equal(flows.finish(state), undefined);
  });

  it("remembers a connected state for a while, and only that one", () => {
    let now = 0;
    const flows = createConnectFlows(() => now);
    const state = startFlow(flows);
    assert.equal(flows.wasConnected(state), false);
    flows.markConnected(state);
    assert.equal(flows.wasConnected(state), true);
    assert.equal(flows.wasConnected("another"), false);
    now = tenMinutes + 1;
    assert.equal(flows.wasConnected(state), false);
  });
});
