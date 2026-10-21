import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// These tests speak the protocol to `amora graph mcp` over its stdin and
// stdout, the way Claude Code or Codex would.

type Reply = {
  jsonrpc: string;
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

function folderWith(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "amora-mcp-"));
  for (const [path, content] of Object.entries(files)) write(folder, path, content);
  return folder;
}

function write(folder: string, path: string, content: string): void {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), content);
}

// The marker sits inside a function body: it must never reach the client.
const app = {
  "package.json": "{}",
  "src/auth.ts": `export function login(user: string) {
  const marker = "BODY-MARKER-7f3a";
  return check(user) && marker.length > 0;
}
function check(user: string) { return user.length > 0; }
export class Store { save() { return 1; } }`,
  "src/session.ts": `import { login } from "./auth.js";
export const signIn = (user: string) => login(user);`,
  "src/pages/Home.tsx": `import * as session from "../session";
export function Home() { session.signIn("a"); return null; }`,
  "test/auth.test.ts": `import { login } from "../src/auth.ts";
login("x");`,
};

class Client {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: string[] = [];
  stderr = "";
  awaited = 0;
  private buffer = "";
  private readonly waiting = new Map<string | number | null, (reply: Reply) => void>();
  private next = 0;

  constructor(folder: string) {
    const main = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
    this.child = spawn(process.execPath, [main, "graph", "mcp", folder], {
      env: { ...process.env, AMORA_HOME: mkdtempSync(join(tmpdir(), "amora-mcp-home-")) },
    });
    this.child.stderr.setEncoding("utf8").on("data", (chunk: string) => (this.stderr += chunk));
    this.child.stdout.setEncoding("utf8").on("data", (chunk: string) => this.receive(chunk));
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    for (let end = this.buffer.indexOf("\n"); end >= 0; end = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      this.stdout.push(line);
      const reply = JSON.parse(line) as Reply;
      this.waiting.get(reply.id)?.(reply);
      this.waiting.delete(reply.id);
    }
  }

  // Sends one raw line and waits for the reply that carries `id`.
  raw(line: string, id: string | number | null): Promise<Reply> {
    this.awaited += 1;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.child.stdin.write(`${line}\n`);
    });
  }

  request(method: string, params?: Record<string, unknown>): Promise<Reply> {
    this.next += 1;
    return this.raw(JSON.stringify({ jsonrpc: "2.0", id: this.next, method, params }), this.next);
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  async call(name: string, args: Record<string, unknown>) {
    const reply = await this.request("tools/call", { name, arguments: args });
    const result = reply.result as { content: { text: string }[]; isError?: boolean };
    const text = result.content[0]?.text ?? "";
    return result.isError ? { error: text } : (JSON.parse(text) as Record<string, unknown>);
  }

  close(): Promise<number | null> {
    return new Promise((resolve) => {
      this.child.on("exit", (code) => resolve(code));
      this.child.stdin.end();
    });
  }
}

describe("amora graph mcp", { timeout: 30_000 }, () => {
  const folder = folderWith(app);
  let client: Client;
  before(() => {
    client = new Client(folder);
  });
  after(() => client.child.kill());

  it("negotiates a protocol version and lists its five tools", async () => {
    const init = await client.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    assert.deepEqual(init.result, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "amora-graph", version: "0.1.0" },
    });
    const newer = await client.request("initialize", { protocolVersion: "2099-01-01" });
    assert.equal(newer.result?.protocolVersion, "2025-06-18");
    // A notification gets no reply: the next reply on stdout is the ping's.
    client.notify("notifications/initialized");
    assert.deepEqual((await client.request("ping")).result, {});
    const { tools } = (await client.request("tools/list")).result as {
      tools: { name: string; inputSchema: { type: string } }[];
    };
    assert.deepEqual(
      tools.map(({ name }) => name),
      ["impact", "callers", "dependencies", "find", "outline"],
    );
    assert.ok(tools.every(({ inputSchema }) => inputSchema.type === "object"));
  });

  it("answers impact, callers, dependencies, find, and outline", async () => {
    const impact = (await client.call("impact", { target: "login" })) as {
      affected: { path: string; depth: number; test: boolean }[];
    };
    assert.deepEqual(
      impact.affected.map(({ path, depth, test }) => [path, depth, test]),
      [
        ["src/auth.ts", 0, false],
        ["src/session.ts", 1, false],
        ["test/auth.test.ts", 1, true],
        ["src/pages/Home.tsx", 2, false],
      ],
    );
    const near = (await client.call("impact", { target: "src/auth.ts#login", depth: 1 })) as {
      affected: unknown[];
    };
    assert.equal(near.affected.length, 3);
    assert.deepEqual(await client.call("callers", { name: "login" }), {
      name: "login",
      callers: [
        { file: "src/session.ts", caller: "signIn", line: 2 },
        { file: "test/auth.test.ts", caller: null, line: 2 },
      ],
    });
    assert.deepEqual(await client.call("dependencies", { file: "src/session.ts" }), {
      file: "src/session.ts",
      imports: ["src/auth.ts"],
    });
    assert.deepEqual(await client.call("find", { name: "save" }), {
      name: "save",
      definitions: [
        { file: "src/auth.ts", name: "Store.save", kind: "method", line: 6, endLine: 6 },
      ],
    });
    assert.deepEqual(await client.call("outline", { path: "src/pages" }), {
      files: { "src/pages/Home.tsx": ["Home()"] },
    });
  });

  it("updates the graph before each answer", async () => {
    write(folder, "src/later.ts", `import { login } from "./auth";\nexport const x = login("b");`);
    const { callers } = (await client.call("callers", { name: "login", file: "src/auth.ts" })) as {
      callers: { file: string }[];
    };
    assert.ok(callers.some(({ file }) => file === "src/later.ts"));
  });

  it("accepts absolute paths inside the project and refuses paths outside it", async () => {
    const inside = join(realpathSync(folder), "src", "session.ts");
    assert.deepEqual(await client.call("dependencies", { file: inside }), {
      file: "src/session.ts",
      imports: ["src/auth.ts"],
    });
    for (const file of ["../outside.ts", "/etc/passwd", "src/../../x.ts"]) {
      assert.match(
        String((await client.call("dependencies", { file })).error),
        /outside the project/,
      );
    }
    for (const target of ["../x.ts", "../x.ts#login"]) {
      assert.match(String((await client.call("impact", { target })).error), /outside the project/);
    }
    assert.match(String((await client.call("outline", { path: ".." })).error), /outside/);
  });

  it("reports bad arguments as tool errors and bad calls as protocol errors", async () => {
    assert.match(String((await client.call("impact", { target: "nothing" })).error), /neither/);
    assert.match(
      String((await client.call("impact", { target: "login", depth: 9 })).error),
      /depth/,
    );
    assert.match(String((await client.call("find", {})).error), /name is required/);
    const unknownTool = await client.request("tools/call", { name: "write_file", arguments: {} });
    assert.equal(unknownTool.error?.code, -32602);
    assert.equal((await client.request("resources/list")).error?.code, -32601);
    assert.equal((await client.raw("{not json", null)).error?.code, -32700);
    assert.equal(
      (await client.raw(`{"jsonrpc":"1.0","id":"a","method":"ping"}`, "a")).error?.code,
      -32600,
    );
  });

  it("sends only protocol messages on stdout, never source contents, and exits when closed", async () => {
    const code = await client.close();
    assert.equal(code, 0);
    // One line per request: the notification got no reply.
    assert.equal(client.stdout.length, client.awaited);
    for (const line of client.stdout) {
      assert.equal((JSON.parse(line) as Reply).jsonrpc, "2.0");
      assert.ok(!line.includes("BODY-MARKER"));
      assert.ok(!line.includes("return check"));
    }
    assert.match(client.stderr, /mcp server ready/);
  });
});
