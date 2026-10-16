import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "yaml";
import type { ModelInfo } from "../src/model-layer/openrouter.ts";
import {
  draftRegistryEntry,
  entryProblems,
  entryToYaml,
} from "../src/model-layer/registry-draft.ts";

const capabilities = {
  vision: true,
  tool_use: true,
  structured_output: "json_schema" as const,
  context: 128000,
};

function draft(info: ModelInfo, overrides: { family?: string; license?: string } = {}) {
  return draftRegistryEntry({
    info,
    capabilities,
    probeDate: "2026-10-16",
    fetchedOn: "2026-10-17",
    family: overrides.family ?? "acme",
    license: overrides.license ?? "MIT",
  });
}

describe("registry entry drafts", () => {
  // 0.0000001 * 1e6 is 0.09999999999999999 in floating point; the registry
  // must hold 0.1.
  it("rounds away float noise in per-million prices", () => {
    const entry = draft({
      id: "acme/m",
      context_length: 1,
      pricing: { prompt: "0.0000001", completion: "0.0000008", input_cache_read: "0.00000057" },
    });
    assert.deepEqual(entry.pricing.per_million, { input: 0.1, output: 0.8, cache_read: 0.57 });
  });

  it("turns per-token prices into per-million figures", () => {
    const entry = draft({
      id: "acme/m",
      context_length: 128000,
      pricing: { prompt: "0.0000003", completion: "0.0000012", input_cache_read: "0.00000003" },
    });
    assert.deepEqual(entry.pricing.per_million, { input: 0.3, output: 1.2, cache_read: 0.03 });
  });

  it("carries the measurements, the dates, and the family and license it was given", () => {
    const entry = draft({
      id: "acme/m",
      context_length: 1,
      expiration_date: "2026-12-01",
      pricing: { prompt: "0", completion: "0" },
    });
    assert.deepEqual(entry.capabilities, capabilities);
    assert.equal(entry.expires, "2026-12-01");
    assert.equal(entry.probe_date, "2026-10-16");
    assert.equal(entry.pricing.effective_from, "2026-10-17");
    assert.equal(entry.base_family, "acme");
    assert.equal(entry.license, "MIT");
    assert.deepEqual(entry.pricing.per_million, { input: 0, output: 0 });
  });

  it("records no expiry as null and refuses a model without a price", () => {
    assert.equal(
      draft({ id: "acme/m", context_length: 1, pricing: { prompt: "0", completion: "0" } }).expires,
      null,
    );
    assert.throws(() => draft({ id: "acme/m", context_length: 1 }), /lists no price for acme\/m/);
    assert.throws(
      () =>
        draft({ id: "acme/m", context_length: 1, pricing: { prompt: "free", completion: "0" } }),
      /lists no price/,
    );
  });

  it("produces YAML the registry loads, and catches an entry it would reject", () => {
    const info = { id: "acme/m", context_length: 1, pricing: { prompt: "0", completion: "0" } };
    const entry = draft(info);
    assert.deepEqual(entryProblems(entry), []);
    assert.deepEqual((parse(entryToYaml(entry)) as unknown[])[0], entry);
    assert.ok(entryProblems(draft(info, { family: "" })).length > 0);
  });
});
