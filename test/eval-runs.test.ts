import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeAgency, runWith, taxSolution } from "./eval-fixture.ts";

describe("benchmark runner, whatever the owner's default roster", () => {
  it("runs the full system with every worker even when the agency offers the slim roster", async () => {
    const agency = {
      ...fakeAgency(taxSolution),
      roster: () => ({ offered: ["fe-engineer", "unit-integration-tester"] }),
    };
    const [row] = await runWith(agency, ["amora"]);
    assert.equal(row?.calls, 9);
  });
});

describe("benchmark runner, with repeated runs", () => {
  it("runs every system on the brief once per round, each in its own folder", async () => {
    const rows = await runWith(fakeAgency(taxSolution), ["slim", "baseline"], "tax", 2);
    assert.deepEqual(
      rows.map(({ run, system, success }) => [run, system, success]),
      [
        [1, "slim", true],
        [1, "baseline", true],
        [2, "slim", true],
        [2, "baseline", true],
      ],
    );
    assert.equal(new Set(rows.map(({ project }) => project)).size, 4);
    assert.match(rows[2]?.project ?? "", /run-2[\\/]slim[\\/]tax/);
  });
});

describe("benchmark runner, when the baseline fails its checks", () => {
  it("keeps the failing check's output in the reason", async () => {
    const [row] = await runWith(fakeAgency("export function totalWithTax( {"), ["baseline"]);
    assert.equal(row?.delivered, false);
    assert.match(row?.reason ?? "", /in 3 attempts\. npm run typecheck failed\. .*SyntaxError/);
  });
});

describe("benchmark runner, when AMORA stops", () => {
  it("reports the task's own stop reason and delivers nothing", async () => {
    const agency = fakeAgency(taxSolution, { verdict: "fail", findings: ["Not good enough."] });
    const [row] = await runWith(agency, ["amora"]);
    assert.equal(row?.delivered, false);
    assert.match(row?.reason ?? "", /did not pass its gate after 3 attempts/);
    assert.equal(row?.success, false);
  });
});
