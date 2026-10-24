import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createConnectFlows } from "../src/runtime/connect.ts";
import { type Chosen, chooseFolder } from "../src/runtime/folder-dialog.ts";
import { createLogger } from "../src/runtime/logger.ts";
import {
  addProject,
  chooseProject,
  currentProject,
  inspectProject,
  listProjects,
  ProjectError,
  removeProject,
  setUpProject,
} from "../src/runtime/projects.ts";
import { memoryStore } from "../src/runtime/secrets.ts";
import { createSessions } from "../src/runtime/security.ts";
import { startRuntime, type Runtime } from "../src/runtime/server.ts";
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
  it("adds any folder, makes it current, and keeps one entry per folder", () => {
    const { storage } = setup({});
    const shop = app({ lint: "x", typecheck: "x", test: "x" });
    const empty = folderWith({});
    addProject(storage, empty);
    assert.equal(inspectProject({ name: "empty", path: empty }, empty).needsSetup, true);
    assert.equal(inspectProject({ name: "shop", path: shop }, shop).needsSetup, false);
    assert.throws(() => addProject(storage, join(shop, "nope")), /is not a folder/);
    assert.deepEqual(addProject(storage, shop), { name: basename(shop), path: shop });
    addProject(storage, shop, "Shop");
    assert.deepEqual(listProjects(storage), [
      { name: basename(empty), path: empty },
      { name: "Shop", path: shop },
    ]);
    assert.equal(currentProject(storage), shop);
  });

  it("refuses the home folder and the folders above it, even with a package.json", () => {
    const { storage } = setup({});
    assert.throws(() => addProject(storage, homedir()), /holds your whole home folder/);
    assert.throws(() => addProject(storage, dirname(homedir())), /holds your whole home folder/);
    assert.match(
      inspectProject({ name: "home", path: homedir() }, undefined).problems[0] ?? "",
      /holds your whole home folder/,
    );
  });

  it("sets up an empty folder with checks that run on Node alone, and never overwrites", () => {
    const { storage } = setup({});
    const folder = folderWith({
      "src/add.ts": "export const add = (a: number, b: number) => a + b;\n",
    });
    assert.throws(() => setUpProject(storage, folder), /Add the project first/);
    addProject(storage, folder);
    setUpProject(storage, folder);
    const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest.scripts), ["typecheck", "test"]);
    assert.equal(inspectProject({ name: "f", path: folder }, folder).needsSetup, false);
    assert.throws(
      () => setUpProject(storage, folder),
      /already has package\.json and scripts\/check\.mjs/,
    );
    // The scripts as npm runs them, with this Node.
    const npm = (script: string) =>
      spawnSync(process.execPath, script.split(" ").slice(1), { cwd: folder, encoding: "utf8" });
    assert.equal(npm(manifest.scripts.typecheck).status, 0);
    assert.equal(npm(manifest.scripts.test).status, 0);
    writeFileSync(join(folder, "src", "broken.ts"), "export const x = (a: number => a;\n");
    const broken = npm(manifest.scripts.typecheck);
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /^src[\\/]broken\.ts: /);
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

type Reply = { status: number; body: string };

function call(port: number, method: string, path: string, cookie: string, json?: unknown) {
  const body = json === undefined ? undefined : JSON.stringify(json);
  const headers: Record<string, string> = {
    host: `127.0.0.1:${port}`,
    cookie,
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  };
  return new Promise<Reply>((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method, headers }, (incoming) => {
      let text = "";
      incoming.on("data", (chunk) => (text += chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body: text }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

describe("the project picker's API", () => {
  const world = setup({});
  const sessions = createSessions();
  let runtime: Runtime;
  let cookie = "";
  let picked: Chosen = { cancelled: true };

  before(async () => {
    runtime = await startRuntime(40000 + Math.floor(Math.random() * 10000), {
      sessions,
      flows: createConnectFlows(),
      secrets: memoryStore(),
      logger: createLogger(() => undefined),
      chooseFolder: async () => picked,
      tasks: {
        orchestrator: world.runtime,
        storage: world.storage,
        roles: {},
        divisions: {},
        readiness: () => [],
        project: () => currentProject(world.storage),
      },
    });
    const token = new URL(runtime.signInUrl()).searchParams.get("token") ?? "";
    cookie = await new Promise<string>((resolve) => {
      const headers = { host: `127.0.0.1:${runtime.port}` };
      const path = `/auth/sign-in?token=${token}`;
      request({ host: "127.0.0.1", port: runtime.port, path, headers }, (incoming) =>
        resolve(String(incoming.headers["set-cookie"]).split(";")[0] ?? ""),
      ).end();
    });
  });
  after(() => runtime.close());

  it("adds, lists, and chooses projects, and refuses what is not one", async () => {
    const shop = app({ lint: "x" });
    const added = await call(runtime.port, "POST", "/api/projects", cookie, {
      path: shop,
      name: "Shop",
    });
    assert.equal(added.status, 201);
    const listed = JSON.parse(added.body) as {
      projects: { name: string; current: boolean; missingScripts: string[] }[];
      delivery: string;
    };
    assert.deepEqual(
      listed.projects.map(({ name, current }) => [name, current]),
      [["Shop", true]],
    );
    assert.deepEqual(listed.projects[0]?.missingScripts, ["test"]);
    assert.equal(listed.delivery, "branch");
    const refused = await call(runtime.port, "POST", "/api/projects", cookie, {
      path: join(shop, "package.json"),
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body, /is not a folder/);
    const unknown = await call(runtime.port, "POST", "/api/projects/current", cookie, {
      path: app({}),
    });
    assert.equal(unknown.status, 400);
    assert.match(unknown.body, /Add the project first/);
    assert.equal((await call(runtime.port, "GET", "/api/projects", "")).status, 401);
  });

  it("adds the folder picked in the system's dialog, or says why it cannot be a project", async () => {
    const choose = () => call(runtime.port, "POST", "/api/folders/choose", cookie);
    const docs = app({});
    picked = { path: docs };
    const added = await choose();
    assert.equal(added.status, 201);
    assert.ok(added.body.includes(JSON.stringify(docs)));
    picked = { path: join(docs, "nope") };
    const refused = await choose();
    assert.equal(refused.status, 400);
    assert.match(refused.body, /is not a folder/);
    picked = { cancelled: true };
    assert.deepEqual(JSON.parse((await choose()).body), { cancelled: true });
    picked = { unavailable: "This computer has no folder dialog AMORA can open." };
    assert.equal((await choose()).status, 501);
    const removed = await call(runtime.port, "POST", "/api/projects/remove", cookie, {
      path: docs,
    });
    assert.ok(!removed.body.includes(JSON.stringify(docs)));
  });
});

describe("the system's folder dialog", () => {
  it("runs a fixed command per system, and tells a choice from a cancel and a missing dialog", async () => {
    const calls: string[] = [];
    const answers: Record<string, { code: number; stdout: string; missing?: boolean }> = {
      osascript: { code: 0, stdout: "/Users/you/shop/\n" },
      zenity: { code: 0, stdout: "", missing: true },
      kdialog: { code: 1, stdout: "" },
      powershell: { code: 0, stdout: "" },
    };
    const run = async (command: string) => (
      calls.push(command),
      answers[command] ?? { code: 1, stdout: "" }
    );
    assert.deepEqual(await chooseFolder("darwin", run), { path: "/Users/you/shop" });
    assert.deepEqual(await chooseFolder("linux", run), { cancelled: true });
    assert.deepEqual(await chooseFolder("win32", run), { cancelled: true });
    assert.deepEqual(calls, ["osascript", "zenity", "kdialog", "powershell"]);
    const none = async () => ({ code: 1, stdout: "", missing: true });
    assert.match(JSON.stringify(await chooseFolder("linux", none)), /no folder dialog/);
  });
});
