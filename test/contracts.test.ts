import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { familyLookup, familyProblem } from "../src/model-layer/families.ts";
import type { ChatRequest } from "../src/model-layer/gateway.ts";
import { saveCombo } from "../src/model-layer/known-models.ts";
import { loadContracts } from "../src/runtime/contracts.ts";
import { openStorage } from "../src/runtime/storage.ts";
import { callWorker } from "../src/runtime/worker-runner.ts";
import { reply } from "./replies.ts";

const { items: contracts, errors } = loadContracts(
  fileURLToPath(new URL("../contracts", import.meta.url)),
);
const review = contracts.find(({ id }) => id === "review.v1");
if (!review) throw new Error("review.v1 did not load");

describe("contracts", () => {
  it("load from contracts/ without errors", () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(contracts.map(({ id }) => id).sort(), ["plan.v1", "review.v1"]);
  });

  it("refuse fields a contract does not have, naming where", () => {
    assert.deepEqual(review.check({ verdict: "pass", findings: [] }), []);
    assert.match(
      review.check({ verdict: "maybe", findings: [] }).join(),
      /\/verdict must be equal/,
    );
    assert.match(review.check({ verdict: "pass", findings: [], extra: 1 }).join(), /additional/);
  });
});

describe("worker runner", () => {
  const call = (structured: "json_schema" | "json_mode" | "none", texts: (string | null)[]) => {
    const requests: ChatRequest[] = [];
    const chat = async (request: ChatRequest) => {
      requests.push(request);
      return reply(texts[requests.length - 1] ?? null);
    };
    const result = callWorker({
      chat,
      model: "m",
      structured,
      prompt: "Review.",
      contract: review,
      input: {},
    });
    return { requests, result };
  };

  it("asks for the strict schema when the model honours it", async () => {
    const { requests, result } = call("json_schema", ['{"verdict":"pass","findings":[]}']);
    assert.equal((await result).validation, "valid");
    assert.deepEqual(requests[0]?.response_format?.type, "json_schema");
    assert.equal((requests[0]?.response_format?.json_schema as { name: string }).name, "review_v1");
  });

  it("uses JSON mode, or nothing, for models that cannot do more, and reads fenced JSON", async () => {
    const mode = call("json_mode", ['{"verdict":"pass","findings":[]}']);
    await mode.result;
    assert.deepEqual(mode.requests[0]?.response_format, { type: "json_object" });
    const plain = call("none", ['```json\n{"verdict":"fail","findings":["x"]}\n```']);
    assert.deepEqual((await plain.result).output, { verdict: "fail", findings: ["x"] });
    assert.equal(plain.requests[0]?.response_format, undefined);
  });

  it("gives up as invalid after one repair, keeping the problems", async () => {
    const { requests, result } = call("none", [null, "not json"]);
    const outcome = await result;
    assert.equal(outcome.validation, "invalid");
    assert.equal(outcome.output, undefined);
    assert.deepEqual(outcome.problems, ["The reply was not valid JSON."]);
    assert.match(String(requests[1]?.messages.at(-1)?.content), /The reply was empty/);
  });
});

describe("model families for the ≠ rule", () => {
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
  storage.setSetting("families", {
    "omniroute:a/claude": "claude",
    "omniroute:a/gemini": "gemini",
  });
  saveCombo(storage, "omniroute:mix", {
    members: ["omniroute:a/claude", "omniroute:a/gemini"],
    contextLength: null,
    strategy: "priority",
  });
  const lookup = familyLookup(storage, { version: 1, models: [] });

  it("counts every member of a combo", () => {
    assert.deepEqual(lookup("omniroute:mix"), ["claude", "gemini"]);
    const problem = familyProblem(
      { role: "Reality Checker", model: "omniroute:a/gemini" },
      { role: "Slice / Markup Engineer", model: "omniroute:mix" },
      lookup,
    );
    assert.match(problem ?? "", /both use gemini/);
  });

  it("accepts different families and reports an unknown one", () => {
    const reviewer = { role: "Reality Checker", model: "omniroute:a/claude" };
    assert.equal(
      familyProblem(reviewer, { role: "W", model: "omniroute:a/gemini" }, lookup),
      undefined,
    );
    assert.match(
      familyProblem(reviewer, { role: "W", model: "omniroute:a/unknown" }, lookup) ?? "",
      /unknown/,
    );
  });
});
