import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  capabilityLookup,
  probedCapabilities,
  saveProbeResults,
} from "../src/model-layer/known-models.ts";
import {
  loadRegistry,
  type ModelCapabilities,
  type Registry,
} from "../src/model-layer/registry.ts";
import { assignModel, emptySlots, resolveWorker } from "../src/model-layer/slots.ts";
import { loadManifests } from "../src/runtime/manifests.ts";
import { openStorage } from "../src/runtime/storage.ts";

const [slice] = loadManifests(fileURLToPath(new URL("../workers", import.meta.url))).items;
if (!slice) throw new Error("the example manifest did not load");

const capable: ModelCapabilities = {
  vision: true,
  tool_use: true,
  structured_output: "json_schema",
  context: 200_000,
};
const textOnly: ModelCapabilities = { ...capable, vision: false, context: 32_000 };
const known: Record<string, ModelCapabilities> = { "a/capable": capable, "b/text-only": textOnly };
const lookup = (model: string) => known[model];

function tempStorage() {
  return openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
}

describe("slot resolution", () => {
  it("prefers worker, then division, then global", () => {
    const config = { global: "b/text-only", divisions: { forge: "a/capable" }, workers: {} };
    assert.equal(resolveWorker(slice, config, lookup).level, "division");
    const override = { ...config, workers: { "fe-slice-engineer": "a/capable" } };
    assert.equal(resolveWorker(slice, override, lookup).level, "worker");
    assert.equal(
      resolveWorker(slice, { ...emptySlots, global: "a/capable" }, lookup).level,
      "global",
    );
  });

  it("reports why a default does not fit instead of falling back", () => {
    const config = { global: "a/capable", divisions: { forge: "b/text-only" }, workers: {} };
    const resolution = resolveWorker(slice, config, lookup);
    assert.equal(resolution.verdict, "rejected");
    assert.equal(resolution.model, "b/text-only");
    assert.deepEqual(resolution.problems, [
      "This model doesn't support vision, but Slice / Markup Engineer requires it.",
      "This model's context is 32000 tokens, but Slice / Markup Engineer needs at least 128000.",
    ]);
  });

  it("marks unassigned and unprobed workers", () => {
    assert.equal(resolveWorker(slice, emptySlots, lookup).verdict, "unassigned");
    assert.equal(
      resolveWorker(slice, { ...emptySlots, global: "c/new" }, lookup).verdict,
      "unprobed",
    );
  });

  it("refuses a worker override that does not fit, and accepts one that does", () => {
    const target = { level: "worker" as const, key: "fe-slice-engineer" };
    const refused = assignModel(emptySlots, target, "b/text-only", { manifest: slice, lookup });
    assert.ok("problems" in refused && refused.problems.length === 2);
    const accepted = assignModel(emptySlots, target, "a/capable", { manifest: slice, lookup });
    assert.ok("config" in accepted);
    assert.equal(accepted.config.workers["fe-slice-engineer"], "a/capable");
  });

  it("accepts division and global defaults", () => {
    const division = assignModel(emptySlots, { level: "division", key: "forge" }, "b/text-only", {
      lookup,
    });
    assert.ok("config" in division && division.config.divisions.forge === "b/text-only");
  });
});

describe("registry", () => {
  it("loads the shipped registry", () => {
    const { registry, errors } = loadRegistry(
      fileURLToPath(new URL("../registry/models.yaml", import.meta.url)),
    );
    assert.deepEqual(errors, []);
    assert.ok(Number.isInteger(registry.version) && registry.version >= 1);
    // Every shipped entry names its source, license, and family, and has been probed.
    for (const entry of registry.models) {
      assert.match(entry.pricing.source, /^https:\/\//);
      assert.ok(entry.license && entry.base_family && entry.probe_date);
    }
    const models = registry.models.map((entry) => entry.model);
    assert.equal(new Set(models).size, models.length);
  });

  it("rejects an entry without a pricing source", () => {
    const path = join(mkdtempSync(join(tmpdir(), "amora-registry-")), "models.yaml");
    writeFileSync(path, "version: 1\nmodels:\n  - model: a/b\n    base_family: a\n");
    const { errors } = loadRegistry(path);
    assert.ok(errors.some((error) => error.includes("must have required property 'pricing'")));
  });
});

describe("probe storage", () => {
  const results = [
    { capability: "structured_output" as const, result: "json_mode", detail: "JSON mode only" },
    { capability: "tool_use" as const, result: "true", detail: "called the tool" },
    { capability: "vision" as const, result: "false", detail: "no image input" },
    { capability: "context" as const, result: "65536", detail: "provider metadata" },
  ];

  it("stores results with their date and reads them back", () => {
    const storage = tempStorage();
    saveProbeResults(storage, "a/b", results, new Date("2026-10-15T00:00:00Z"));
    assert.deepEqual(probedCapabilities(storage, "a/b"), {
      capabilities: {
        structured_output: "json_mode",
        tool_use: true,
        vision: false,
        context: 65536,
      },
      probedAt: "2026-10-15T00:00:00.000Z",
    });
  });

  it("treats a half-probed model as unknown", () => {
    const storage = tempStorage();
    saveProbeResults(storage, "a/b", results.slice(0, 2));
    assert.equal(probedCapabilities(storage, "a/b"), undefined);
  });

  it("prefers the user's probes over the registry", () => {
    const storage = tempStorage();
    saveProbeResults(storage, "a/b", results);
    const registry = { version: 1, models: [{ model: "a/b", capabilities: capable }] } as Registry;
    assert.equal(capabilityLookup(storage, registry)("a/b")?.vision, false);
  });

  it("keeps settings across reopening, so migrations run once", () => {
    const path = join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db");
    const first = openStorage(path);
    first.setSetting("slots", { global: "a/b" });
    first.close();
    assert.deepEqual(openStorage(path).getSetting("slots"), { global: "a/b" });
  });
});
