import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadManifests } from "../src/runtime/manifests.ts";

const example = readFileSync(
  new URL("../workers/forge/fe-slice-engineer.yaml", import.meta.url),
  "utf8",
);

function workersWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "amora-workers-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("manifest loader", () => {
  it("loads the PRD example manifest", () => {
    const { items, errors } = loadManifests(new URL("../workers", import.meta.url).pathname);
    assert.deepEqual(errors, []);
    assert.equal(items[0]?.id, "fe-slice-engineer");
    assert.equal(items[0]?.requires.vision, true);
  });

  it("reports every problem with the file and field", () => {
    const broken = example
      .replace("wave: 1", "wave: 4")
      .replace("max_retries: 3", "max_retries: 5");
    const { items, errors } = loadManifests(workersWith({ "forge/broken.yaml": broken }));
    assert.equal(items.length, 0);
    assert.equal(errors.length, 2);
    assert.ok(errors.every((error) => error.startsWith("forge/broken.yaml: ")));
  });

  it("rejects unknown fields", () => {
    const { errors } = loadManifests(
      workersWith({ "forge/extra.yaml": `${example}\nmood: happy\n` }),
    );
    assert.match(errors[0] ?? "", /must NOT have additional properties/);
  });

  it("requires the folder to match the division", () => {
    const { errors } = loadManifests(workersWith({ "atelier/moved.yaml": example }));
    assert.deepEqual(errors, [
      'atelier/moved.yaml: division is "forge" but the file is in atelier/',
    ]);
  });

  it("rejects two manifests with the same id", () => {
    const { errors } = loadManifests(
      workersWith({ "forge/a.yaml": example, "forge/b.yaml": example }),
    );
    assert.deepEqual(errors, ['worker id "fe-slice-engineer" is used by more than one manifest']);
  });

  it("treats a missing workers folder as empty", () => {
    assert.deepEqual(loadManifests(join(tmpdir(), "amora-does-not-exist")), {
      items: [],
      errors: [],
    });
  });
});
