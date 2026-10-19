import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeAgency, runWith, taxSolution } from "./eval-fixture.ts";

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
