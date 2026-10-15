import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { refreshRegistry, selectRegistry } from "../src/model-layer/registry-source.ts";
import { parseRegistry } from "../src/model-layer/registry.ts";

const registry = (version: number) => `version: ${version}\nmodels: []\n`;

function folderWith(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "amora-registry-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  return folder;
}

function serving(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

describe("registry parsing", () => {
  it("reports broken YAML and HTML pages as errors instead of throwing", () => {
    assert.match(parseRegistry("models: [").errors[0] ?? "", /^not valid YAML/);
    assert.ok(parseRegistry("<html><body>404</body></html>").errors.length > 0);
  });
});

describe("registry selection", () => {
  it("uses the bundled registry when nothing is cached", () => {
    const folder = folderWith({ "bundled.yaml": registry(2) });
    const selected = selectRegistry(join(folder, "bundled.yaml"), join(folder, "cache.yaml"));
    assert.equal(selected.source, "bundled");
    assert.equal(selected.registry.version, 2);
  });

  it("uses a cached registry only when it is valid and newer", () => {
    const newer = folderWith({ "bundled.yaml": registry(2), "cache.yaml": registry(3) });
    assert.equal(
      selectRegistry(join(newer, "bundled.yaml"), join(newer, "cache.yaml")).source,
      "fetched",
    );
    const older = folderWith({ "bundled.yaml": registry(2), "cache.yaml": registry(1) });
    assert.equal(
      selectRegistry(join(older, "bundled.yaml"), join(older, "cache.yaml")).source,
      "bundled",
    );
    const broken = folderWith({
      "bundled.yaml": registry(2),
      "cache.yaml": "version: 9\nmodels: oops\n",
    });
    const selected = selectRegistry(join(broken, "bundled.yaml"), join(broken, "cache.yaml"));
    assert.deepEqual([selected.source, selected.registry.version], ["bundled", 2]);
  });
});

describe("registry refresh", () => {
  it("caches a newer registry", async () => {
    const cache = join(folderWith({}), "cache.yaml");
    assert.equal(await refreshRegistry(cache, 1, serving(200, registry(2))), "updated");
    assert.equal(readFileSync(cache, "utf8"), registry(2));
    assert.equal(existsSync(`${cache}.tmp`), false);
  });

  it("does not write when the download is not newer", async () => {
    const cache = join(folderWith({}), "cache.yaml");
    assert.equal(await refreshRegistry(cache, 2, serving(200, registry(2))), "current");
    assert.equal(existsSync(cache), false);
  });

  it("refuses failed, invalid, and oversized downloads and keeps the old cache", async () => {
    const folder = folderWith({ "cache.yaml": registry(3) });
    const cache = join(folder, "cache.yaml");
    await assert.rejects(refreshRegistry(cache, 3, serving(404, "Not Found")), /HTTP 404/);
    await assert.rejects(refreshRegistry(cache, 3, serving(200, "version: 9\n")), /invalid/);
    await assert.rejects(
      refreshRegistry(cache, 3, serving(200, "#".repeat(1_000_001))),
      /too large/,
    );
    assert.equal(readFileSync(cache, "utf8"), registry(3));
  });
});
