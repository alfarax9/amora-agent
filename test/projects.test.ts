import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, it } from "node:test";
import {
  addProject,
  chooseProject,
  currentProject,
  inspectProject,
  listProjects,
  ProjectError,
  removeProject,
} from "../src/runtime/projects.ts";
import { setup } from "./agency.ts";

function folderWith(files: Record<string, string>): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "amora-project-")));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(folder, path, ".."), { recursive: true });
    writeFileSync(join(folder, path), content);
  }
  return folder;
}

const app = (scripts: Record<string, string>) =>
  folderWith({ "package.json": JSON.stringify({ scripts }) });

describe("projects", () => {
  it("adds a folder with a package.json, makes it current, and keeps one entry per folder", () => {
    const { storage } = setup({});
    const shop = app({ lint: "x", typecheck: "x", test: "x" });
    assert.throws(() => addProject(storage, folderWith({})), /has no package\.json/);
    assert.throws(() => addProject(storage, join(shop, "nope")), /is not a folder/);
    assert.deepEqual(addProject(storage, shop), { name: basename(shop), path: shop });
    addProject(storage, shop, "Shop");
    assert.deepEqual(listProjects(storage), [{ name: "Shop", path: shop }]);
    assert.equal(currentProject(storage), shop);
  });

  it("takes a project off the list without touching it, and the current one with it", () => {
    const { storage } = setup({});
    const shop = app({});
    addProject(storage, shop);
    removeProject(storage, shop);
    assert.deepEqual(listProjects(storage), []);
    assert.equal(currentProject(storage), undefined);
  });

  it("lists a folder chosen with amora project before the list existed", () => {
    const { storage } = setup({});
    const older = app({});
    storage.setSetting("project", { path: older });
    assert.deepEqual(
      listProjects(storage).map(({ path }) => path),
      [older],
    );
  });

  it("chooses only a listed folder that is still a project", () => {
    const { storage } = setup({});
    const one = app({});
    const two = app({});
    addProject(storage, one);
    assert.throws(() => chooseProject(storage, two), ProjectError);
    addProject(storage, two);
    chooseProject(storage, one);
    assert.equal(currentProject(storage), one);
  });

  it("says which gate scripts a project lacks and whether it is a git work tree", () => {
    const plain = app({ test: "node --test" });
    const check = inspectProject({ name: "plain", path: plain }, plain);
    assert.deepEqual(check.missingScripts, ["lint", "typecheck"]);
    assert.equal(check.git, false);
    assert.equal(check.current, true);
    const repo = app({});
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
    assert.equal(inspectProject({ name: "repo", path: repo }, undefined).git, true);
    const broken = folderWith({ "package.json": "{" });
    assert.match(
      inspectProject({ name: "b", path: broken }, undefined).problems[0] ?? "",
      /not valid JSON/,
    );
  });
});
