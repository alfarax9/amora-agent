import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProviderFailure } from "../src/evals/outage.ts";
import { type Chat, type ChatRequest, GatewayError } from "../src/model-layer/gateway.ts";
import type { Agency } from "../src/runtime/agency.ts";
import { fakeAgency, runSuiteWith, taxSolution } from "./eval-fixture.ts";

// An agency whose model calls go through `fail` first: it throws for the calls
// it wants to fail, and every call is counted.
function failing(fail: (request: ChatRequest, call: number) => void, review?: unknown) {
  const base = fakeAgency(taxSolution, review);
  const count = { calls: 0 };
  const agency: Agency = {
    ...base,
    connect: async (model) => {
      const connected = await base.connect(model);
      const chat: Chat = async (request) => {
        count.calls += 1;
        fail(request, count.calls);
        return connected.chat(request);
      };
      return { ...connected, chat };
    },
  };
  return { agency, count };
}

const isBaseline = (request: ChatRequest) =>
  String(request.messages[0]?.content).startsWith("Do it all.");
const quota = () => {
  throw new GatewayError(429, "All accounts have exhausted their quota (reset after 5m)");
};

describe("benchmark runner, when a provider fails", () => {
  it("stops, and scores the brief it stopped on for no system", async () => {
    const { agency, count } = failing((request) => (isBaseline(request) ? undefined : quota()));
    const result = await runSuiteWith(agency, ["single-agent", "small"], ["tax", "discount"]);
    assert.deepEqual(result.rows, []);
    assert.match(result.stopped ?? "", /^tax \(small, run 1\): All accounts have exhausted/);
    // The baseline's one call on tax, then the Planner's call and its two retries.
    assert.equal(count.calls, 4);
  });

  it("keeps scoring when a retried call succeeds", async () => {
    const { agency } = failing((_request, call) => (call === 1 ? quota() : undefined));
    const result = await runSuiteWith(agency, ["small"]);
    assert.equal(result.stopped, undefined);
    assert.equal(result.rows[0]?.success, true);
  });

  it("scores the system's own failure after a provider failure it got past", async () => {
    const rejected = { verdict: "fail", findings: ["Not good enough."] };
    const { agency } = failing((_request, call) => (call === 1 ? quota() : undefined), rejected);
    const result = await runSuiteWith(agency, ["small"]);
    assert.equal(result.stopped, undefined);
    assert.match(result.rows[0]?.reason ?? "", /did not pass its gate/);
  });

  it("still counts a failure that is the system's own", async () => {
    const { agency } = failing(() => {
      throw new GatewayError(400, "The request was malformed.");
    });
    const result = await runSuiteWith(agency, ["single-agent"]);
    assert.equal(result.stopped, undefined);
    assert.equal(result.rows[0]?.delivered, false);
    assert.match(result.rows[0]?.reason ?? "", /malformed/);
  });

  it("tells provider failures from the system's own", () => {
    for (const status of [401, 402, 403, 429, 500, 503]) {
      assert.equal(isProviderFailure(new GatewayError(status, "x")), true, String(status));
    }
    for (const status of [400, 404, 422]) {
      assert.equal(isProviderFailure(new GatewayError(status, "x")), false, String(status));
    }
    assert.equal(isProviderFailure(new TypeError("fetch failed")), true);
    assert.equal(isProviderFailure(new TypeError("terminated")), true);
    assert.equal(isProviderFailure(new TypeError("x is not a function")), false);
    assert.equal(isProviderFailure(new Error("No answer from the gateway within 300 s.")), false);
  });
});
