import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { probedCapabilities, saveProbeResults } from "../src/model-layer/known-models.ts";
import { openStorage } from "../src/runtime/storage.ts";

const key = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;

function tempStorage() {
  return openStorage(join(mkdtempSync(join(tmpdir(), "amora-db-")), "amora.db"));
}

const results = [
  { capability: "structured_output" as const, result: "json_mode", detail: "JSON mode only" },
  { capability: "tool_use" as const, result: "true", detail: "called the tool" },
  { capability: "vision" as const, result: "false", detail: "no image input" },
  { capability: "context" as const, result: "65536", detail: "provider metadata" },
];

describe("secrets never reach the database (S6)", () => {
  it("refuses a setting that holds a key, without echoing it or storing anything", () => {
    const storage = tempStorage();
    assert.throws(
      () => storage.setSetting("slots", { global: key }),
      (error: Error) =>
        error.message ===
          'Refusing to store a OpenRouter key in setting "slots". Secrets belong in the keychain.' &&
        !error.message.includes("a1b2c3d4"),
    );
    assert.equal(storage.getSetting("slots"), undefined);
  });

  it("keeps ordinary settings working, including ones that merely mention keys", () => {
    const storage = tempStorage();
    storage.setSetting("slots", { global: "a/b", note: "keys live in the keychain" });
    assert.deepEqual(storage.getSetting("slots"), {
      global: "a/b",
      note: "keys live in the keychain",
    });
  });

  it("refuses probe results that hold a key, and writes none of the rows", () => {
    const storage = tempStorage();
    const tainted = [...results.slice(0, 3), { ...results[3]!, detail: `provider said ${key}` }];
    assert.throws(
      () => saveProbeResults(storage, "a/b", tainted),
      /Refusing to store a OpenRouter key in probe results/,
    );
    assert.equal(probedCapabilities(storage, "a/b"), undefined);
    const rows = storage.database.prepare("SELECT COUNT(*) AS n FROM model_probes").get() as {
      n: number;
    };
    assert.equal(rows.n, 0);
  });
});
