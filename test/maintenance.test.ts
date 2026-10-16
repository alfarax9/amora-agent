import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  probedCapabilities,
  saveProbeResults,
  staleProbes,
} from "../src/model-layer/known-models.ts";
import { GatewayError, type ChatRequest } from "../src/model-layer/gateway.ts";
import { type OpenRouter } from "../src/model-layer/openrouter.ts";
import { reprobeStale } from "../src/model-layer/reprobe.ts";
import {
  assignedModels,
  assignModel,
  emptySlots,
  unassignModel,
} from "../src/model-layer/slots.ts";
import { loadManifests } from "../src/runtime/manifests.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { openStorage } from "../src/runtime/storage.ts";
import { dayMs } from "../src/runtime/time.ts";

const probed = new Date("2026-10-01T00:00:00Z");
const results = [
  {
    capability: "structured_output" as const,
    result: "json_schema",
    detail: "old",
  },
  { capability: "tool_use" as const, result: "true", detail: "old" },
  { capability: "vision" as const, result: "false", detail: "old" },
  { capability: "context" as const, result: "1000", detail: "old" },
];

function tempStorage() {
  return openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
}

describe("models in use", () => {
  it("lists each assigned model once", () => {
    const config = {
      global: "a/one",
      divisions: { forge: "a/one" },
      workers: { x: "b/two" },
    };
    assert.deepEqual(assignedModels(config), ["a/one", "b/two"]);
    assert.deepEqual(assignedModels(emptySlots), []);
  });
});

describe("stale probes", () => {
  it("flags a probe older than seven days, and only that", () => {
    const storage = tempStorage();
    saveProbeResults(storage, "a/old", results, probed);
    saveProbeResults(storage, "a/new", results, new Date(probed.getTime() + 6 * dayMs));
    const now = probed.getTime() + 8 * dayMs;
    assert.deepEqual(staleProbes(storage, ["a/old", "a/new", "a/never"], now), ["a/old"]);
  });
});

function fakeOpenRouter(
  failing: Record<string, GatewayError> = {},
): OpenRouter & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    model: async (id) => ({ id, context_length: 2000 }),
    keyInfo: async () => ({
      label: "k",
      is_free_tier: false,
      limit_remaining: null,
    }),
    chat: async (request: ChatRequest) => {
      asked.push(request.model);
      const failure = failing[request.model];
      if (failure) throw failure;
      const answer = '{"answer":5}';
      if (request.tools) {
        return {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ function: { name: "submit_result", arguments: answer } }],
              },
            },
          ],
        };
      }
      return {
        choices: [{ message: { content: request.response_format ? answer : "Red." } }],
      };
    },
  };
}

describe("scheduled re-probes", () => {
  const late = probed.getTime() + 8 * dayMs;

  it("measures stale models in use again and keeps fresh ones alone", async () => {
    const storage = tempStorage();
    saveProbeResults(storage, "a/stale", results, probed);
    saveProbeResults(storage, "a/fresh", results, new Date(late - dayMs));
    const openRouter = fakeOpenRouter();
    const refreshed = await reprobeStale({
      storage,
      openRouter,
      models: ["a/stale", "a/fresh"],
      logger: createLogger(() => undefined),
      now: late,
    });
    assert.deepEqual(refreshed, ["a/stale"]);
    assert.ok(openRouter.asked.every((model) => model === "a/stale"));
    assert.equal(probedCapabilities(storage, "a/stale")?.capabilities.context, 2000);
    assert.equal(probedCapabilities(storage, "a/fresh")?.capabilities.context, 1000);
  });

  it("reports a model that needs data collection and carries on with the next", async () => {
    const storage = tempStorage();
    saveProbeResults(storage, "a/private", results, probed);
    saveProbeResults(storage, "b/ok", results, probed);
    const policy = new GatewayError(
      404,
      "No endpoints found matching your data policy (Free model training).",
    );
    const lines: string[] = [];
    const refreshed = await reprobeStale({
      storage,
      openRouter: fakeOpenRouter({ "a/private": policy }),
      models: ["a/private", "b/ok"],
      logger: createLogger((line) => lines.push(line)),
      now: late,
    });
    assert.deepEqual(refreshed, ["b/ok"]);
    assert.equal(probedCapabilities(storage, "a/private")?.capabilities.context, 1000);
    assert.match(lines.join(""), /needs data collection allowed/);
  });
});

describe("models that expire", () => {
  const lookup = () => ({
    vision: false,
    tool_use: true,
    structured_output: "none" as const,
    context: 1000,
  });

  it("cannot be the global default, but can serve a division", () => {
    const refused = assignModel(emptySlots, { level: "global" }, "a/b", {
      lookup,
      expires: "2026-10-31",
    });
    assert.ok("problems" in refused);
    assert.match(refused.problems[0] ?? "", /expires on 2026-10-31.*cannot be the global default/);
    const division = assignModel(emptySlots, { level: "division", key: "forge" }, "a/b", {
      lookup,
      expires: "2026-10-31",
    });
    assert.ok("config" in division);
    const plain = assignModel(emptySlots, { level: "global" }, "a/b", {
      lookup,
    });
    assert.ok("config" in plain);
  });
});

describe("unassigning a model", () => {
  const [slice] = loadManifests(fileURLToPath(new URL("../workers", import.meta.url))).items;
  if (!slice) throw new Error("the example manifest did not load");
  const capable = {
    vision: true,
    tool_use: true,
    structured_output: "json_schema" as const,
    context: 200000,
  };
  const lookup = () => capable;

  it("undoes an assignment at every level and gives back what it removed", () => {
    for (const [target, manifest] of [
      [{ level: "global" as const }, undefined],
      [{ level: "division" as const, key: "forge" }, undefined],
      [{ level: "worker" as const, key: slice.id }, slice],
    ] as const) {
      const assigned = assignModel(emptySlots, target, "a/model", {
        lookup,
        ...(manifest ? { manifest } : {}),
      });
      assert.ok("config" in assigned);
      const removed = unassignModel(assigned.config, target, manifest);
      assert.ok("config" in removed);
      assert.equal(removed.removed, "a/model");
      assert.deepEqual(removed.config, emptySlots);
    }
  });

  it("leaves the other levels alone", () => {
    const config = {
      global: "a/g",
      divisions: { forge: "a/f", atelier: "a/a" },
      workers: { [slice.model_slot]: "a/w" },
    };
    const outcome = unassignModel(config, { level: "division", key: "forge" });
    assert.ok("config" in outcome);
    assert.deepEqual(outcome.config, {
      ...config,
      divisions: { atelier: "a/a" },
    });
    assert.equal(config.divisions.forge, "a/f");
  });

  it("says so when there is nothing to remove or no such worker", () => {
    assert.deepEqual(unassignModel(emptySlots, { level: "global" }), {
      problems: ["No global model is assigned."],
    });
    assert.deepEqual(unassignModel(emptySlots, { level: "division", key: "forge" }), {
      problems: ["forge has no model of its own."],
    });
    assert.deepEqual(unassignModel(emptySlots, { level: "worker", key: slice.id }, slice), {
      problems: [`${slice.role} has no model of its own.`],
    });
    assert.deepEqual(unassignModel(emptySlots, { level: "worker", key: "nobody" }), {
      problems: ['No worker is named "nobody".'],
    });
  });
});
