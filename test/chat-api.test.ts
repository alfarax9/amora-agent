import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Chat, ChatRequest, ChatResponse } from "../src/model-layer/gateway.ts";
import { createConnectFlows } from "../src/runtime/connect.ts";
import { createLogger } from "../src/runtime/logger.ts";
import { memoryStore } from "../src/runtime/secrets.ts";
import { createSessions } from "../src/runtime/security.ts";
import { startRuntime, type Runtime } from "../src/runtime/server.ts";
import { openStorage } from "../src/runtime/storage.ts";
import { spentSince } from "../src/runtime/task-store.ts";

type Reply = { status: number; body: string };

// A request; with `opened`, called once the response headers arrive, so a
// test can start the model's reply while an event stream listens.
function call(
  port: number,
  method: string,
  path: string,
  options: { cookie?: string; json?: unknown; opened?: () => void } = {},
): Promise<Reply> {
  const body = options.json === undefined ? undefined : JSON.stringify(options.json);
  const headers: Record<string, string> = {
    host: `127.0.0.1:${port}`,
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  };
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method, headers }, (incoming) => {
      options.opened?.();
      let text = "";
      incoming.on("data", (chunk) => (text += chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body: text }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

// The events of a server-sent stream, in order.
const eventsOf = (body: string) =>
  body
    .trim()
    .split("\n\n")
    .map((block) => {
      const [, name = ""] = /^event: (.*)$/m.exec(block) ?? [];
      const [, data = "null"] = /^data: (.*)$/m.exec(block) ?? [];
      return { name, data: JSON.parse(data) as Record<string, unknown> };
    });

const answer = (text: string, cost = 0.002): ChatResponse => ({
  choices: [{ message: { content: text }, finish_reason: "stop" }],
  model: "test/chat-model",
  usage: { prompt_tokens: 10, completion_tokens: 2, cost },
});

type Thread = {
  chat: { id: string; title: string; model: string };
  messages: { role: string; text: string; costUsd: number }[];
  pending: { text: string; error?: string } | null;
};

describe("chat API", () => {
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-chat-")), "amora.db"));
  const sessions = createSessions();
  const requests: ChatRequest[] = [];
  // Each reply the fake model gives; the default streams "Hello there".
  const script: ((
    request: ChatRequest,
    onText: (text: string) => void,
  ) => Promise<ChatResponse>)[] = [];
  const chat: Chat = async (chatRequest, options) => {
    requests.push(chatRequest);
    const onText = options?.onText ?? (() => undefined);
    const next = script.shift();
    if (next) return next(chatRequest, onText);
    onText("Hello");
    onText(" there");
    return answer("Hello there");
  };
  let defaultModel: string | undefined = "openrouter:test/chat-model";
  let runtime: Runtime;
  let cookie = "";
  const post = (path: string, json: unknown = {}) =>
    call(runtime.port, "POST", path, { cookie, json });
  const get = (path: string) => call(runtime.port, "GET", path, { cookie });
  const thread = async (id: string) => JSON.parse((await get(`/api/chats/${id}`)).body) as Thread;
  const settled = async (id: string) => {
    for (let wait = 0; wait < 200; wait += 1) {
      const now = await thread(id);
      if (!now.pending || now.pending.error) return now;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("The reply never finished.");
  };
  const start = async (message: string) => {
    const created = await post("/api/chats", { message });
    assert.equal(created.status, 201, created.body);
    return (JSON.parse(created.body) as Thread).chat.id;
  };

  before(async () => {
    runtime = await startRuntime(40000 + Math.floor(Math.random() * 10000), {
      sessions,
      flows: createConnectFlows(),
      secrets: memoryStore(),
      logger: createLogger(() => undefined),
      chats: {
        storage,
        connect: async () => ({ chat, name: "test/chat-model" }),
        defaultModel: () => defaultModel,
        models: () => ["openrouter:test/chat-model", "openrouter:test/other-model"],
        prompt: "You are the AMORA chat assistant.",
        logger: createLogger(() => undefined),
        retryDelaysMs: [0],
      },
    });
    const token = new URL(runtime.signInUrl()).searchParams.get("token") ?? "";
    const signIn = await new Promise<string>((resolve, reject) => {
      const outgoing = request(
        {
          host: "127.0.0.1",
          port: runtime.port,
          path: `/auth/sign-in?token=${token}`,
          headers: { host: `127.0.0.1:${runtime.port}` },
        },
        (incoming) => (incoming.resume(), resolve(String(incoming.headers["set-cookie"]))),
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
    cookie = signIn.split(";")[0] ?? "";
  });
  after(() => runtime.close());

  it("starts a chat, streams the reply as events, and stores it with its cost", async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    script.push(async (_request, onText) => {
      await gate;
      onText("Hel");
      onText("lo");
      return answer("Hello", 0.004);
    });
    const id = await start("What is a closure?\nIn JavaScript.");
    const stream = await call(runtime.port, "GET", `/api/chats/${id}/events`, {
      cookie,
      opened: release,
    });
    assert.deepEqual(
      eventsOf(stream.body).map(({ name }) => name),
      ["snapshot", "text", "text", "done"],
    );
    const done = await settled(id);
    assert.equal(done.chat.title, "What is a closure?");
    assert.deepEqual(
      done.messages.map(({ role, text }) => [role, text]),
      [
        ["user", "What is a closure?\nIn JavaScript."],
        ["assistant", "Hello"],
      ],
    );
    assert.equal(done.messages[1]?.costUsd, 0.004);
    const listed = JSON.parse((await get("/api/chats")).body) as { chats: { id: string }[] };
    assert.equal(listed.chats[0]?.id, id);
  });

  it("sends the owner's rules and the conversation so far to the model", async () => {
    const saved = await post("/api/rules", { text: "  Always answer in Indonesian.  " });
    assert.deepEqual(JSON.parse(saved.body), { text: "Always answer in Indonesian." });
    const id = await start("Hi");
    await settled(id);
    await post(`/api/chats/${id}/messages`, { message: "And then?" });
    await settled(id);
    const [system, ...rest] = requests.at(-1)?.messages ?? [];
    assert.equal(system?.role, "system");
    assert.match(String(system?.content), /AMORA chat assistant[\s\S]*Always answer in Indonesian/);
    assert.deepEqual(
      rest.map(({ role, content }) => [role, content]),
      [
        ["user", "Hi"],
        ["assistant", "Hello there"],
        ["user", "And then?"],
      ],
    );
    await post("/api/rules", { text: "" });
  });

  it("refuses keys in messages and rules, and stores neither", async () => {
    const key = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;
    const message = await post("/api/chats", { message: `use ${key}` });
    assert.equal(message.status, 400);
    assert.ok(!message.body.includes(key));
    assert.equal((await post("/api/rules", { text: key })).status, 400);
    assert.equal(JSON.parse((await get("/api/rules")).body).text, "");
  });

  it("says why a reply failed, then tries again", async () => {
    script.push(async () => {
      throw new Error("Provider down");
    });
    const id = await start("Hi");
    const failed = await settled(id);
    assert.equal(failed.pending?.error, "Provider down");
    assert.equal(failed.messages.length, 1);
    assert.equal((await post(`/api/chats/${id}/retry`)).status, 202);
    const retried = await settled(id);
    assert.equal(retried.pending, null);
    assert.equal(retried.messages.at(-1)?.text, "Hello there");
  });

  it("chooses among the owner's models and says when there is none", async () => {
    const id = await start("Hi");
    await settled(id);
    const other = await post(`/api/chats/${id}/model`, { model: "openrouter:test/other-model" });
    assert.equal((JSON.parse(other.body) as Thread).chat.model, "openrouter:test/other-model");
    assert.equal((await post(`/api/chats/${id}/model`, { model: "x/unknown" })).status, 400);
    defaultModel = undefined;
    const none = await post("/api/chats", { message: "Hi" });
    assert.equal(none.status, 409);
    assert.match(JSON.parse(none.body).error, /amora models set global/);
    defaultModel = "openrouter:test/chat-model";
  });

  it("stops at the daily limit", async () => {
    storage.setSetting("budgets", { dailyUsd: 0.001 });
    const refused = await post("/api/chats", { message: "Hi" });
    assert.equal(refused.status, 409);
    assert.match(JSON.parse(refused.body).error, /spending limit/);
    storage.setSetting("budgets", { dailyUsd: 100 });
  });

  it("deletes a chat's words but keeps what it cost", async () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const id = await start("Forget this");
    await settled(id);
    const spent = spentSince(storage, midnight);
    const deleted = await post(`/api/chats/${id}/delete`);
    const { chats } = JSON.parse(deleted.body) as { chats: { id: string }[] };
    assert.ok(!chats.some((listed) => listed.id === id));
    assert.equal((await get(`/api/chats/${id}`)).status, 404);
    assert.equal(spentSince(storage, midnight), spent);
    const words = storage.database
      .prepare("SELECT text FROM chat_messages WHERE chat_id = ?")
      .all(id) as { text: string }[];
    assert.ok(words.every(({ text }) => text === ""));
  });
});
