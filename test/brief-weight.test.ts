import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { weighBrief } from "../src/runtime/brief-weight.ts";
import { suite } from "./eval-fixture.ts";

describe("weighing a brief", () => {
  it("calls a whole product heavy on its own", () => {
    assert.deepEqual(weighBrief("Build me a CMS project"), {
      heavy: true,
      reasons: ["a whole product to build"],
    });
  });

  it("calls a brief heavy when two signs meet", () => {
    for (const brief of [
      "Redesign the pricing page so it feels more modern, and make it load faster.",
      "Integrate Stripe payments into checkout and add a new order history page.",
      "Add a login page with email and password, connected to our REST API.",
    ]) {
      assert.equal(weighBrief(brief).heavy, true, brief);
    }
    assert.deepEqual(
      weighBrief("Integrate Stripe payments and add a new order history page.").reasons,
      ["a new page or screen to design", "an outside service to integrate"],
    );
  });

  it("keeps one sign alone light", () => {
    assert.deepEqual(weighBrief("Make the footer look nicer."), {
      heavy: false,
      reasons: ["requirements that need working out"],
    });
    assert.equal(weighBrief("Add a newsletter form that posts to our API.").heavy, false);
  });

  it("reads a link to /login as a link, not a sign-in to build", () => {
    assert.deepEqual(weighBrief("Add links to /, /pricing, and /login.").reasons, []);
  });

  it("counts a long brief and many requests as signs", () => {
    const long = Array.from({ length: 160 }, () => "word").join(" ");
    assert.deepEqual(weighBrief(long).reasons, ["a long brief"]);
    const list = ["Add a.", "Add b.", "Add c.", "Add d.", "Add e.", "Add f."].join("\n");
    assert.deepEqual(weighBrief(list).reasons, ["many separate requests"]);
    assert.equal(weighBrief(`${list}\n${long}`).heavy, true);
  });

  // The benchmark has no heavy brief yet, so there the weighed roster is the
  // slim one, and the slim results stand for it.
  it("weighs every benchmark brief as light", () => {
    const heavy = suite.items.filter((brief) => weighBrief(brief.brief).heavy).map(({ id }) => id);
    assert.deepEqual(heavy, []);
  });
});
