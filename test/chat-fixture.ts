import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import type { Chat, ChatRequest, ChatResponse } from "../src/model-layer/gateway.ts";
import type { Brain } from "../src/runtime/brain.ts";
import { createConnectFlows } from "../src/runtime/connect.ts";
import { createLogger } from "../src/runtime/logger.ts";
import type { Orchestrator } from "../src/runtime/orchestrator.ts";
import type { Gap } from "../src/runtime/readiness.ts";
import { memoryStore } from "../src/runtime/secrets.ts";
import { createSessions } from "../src/runtime/security.ts";
import { startRuntime, type Runtime } from "../src/runtime/server.ts";
import { openStorage } from "../src/runtime/storage.ts";

type Reply = { status: number; body: string };

// A request; with `opened`, called once the response headers arrive, so a
// test can start the model's reply while an event stream listens.
export function call(
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
export const eventsOf = (body: string) =>
  body
    .trim()
    .split("\n\n")
    .map((block) => {
      const [, name = ""] = /^event: (.*)$/m.exec(block) ?? [];
      const [, data = "null"] = /^data: (.*)$/m.exec(block) ?? [];
      return { name, data: JSON.parse(data) as Record<string, unknown> };
    });

export const answer = (text: string, cost = 0.002): ChatResponse => ({
  choices: [{ message: { content: text }, finish_reason: "stop" }],
  model: "test/chat-model",
  usage: { prompt_tokens: 10, completion_tokens: 2, cost },
});

type Message = {
  id: number;
  role: string;
  text: string;
  costUsd: number;
  worker: string | null;
  status: string;
  kind: string;
  taskId: string | null;
  version: number;
  versions: number[];
};

export type Thread = {
  chat: { id: string; title: string; starred: boolean };
  messages: Message[];
  pending: { text: string; error?: string } | null;
};

export const assistant: Brain = {
  worker: "assistant",
  role: "Assistant",
  division: "nexus",
  model: "openrouter:test/chat-model",
  label: "Experimental",
  family: null,
};

type Scripted = (request: ChatRequest, onText: (text: string) => void) => Promise<ChatResponse>;

// A runtime with chat on a scripted model, the Assistant as its brain, and a
// stand-in orchestrator for tasks from chat; each test file gets its own.
export function chatWorld() {
  const storage = openStorage(join(mkdtempSync(join(tmpdir(), "amora-chat-")), "amora.db"));
  const sessions = createSessions();
  const requests: ChatRequest[] = [];
  // Each reply the fake model gives; the default streams "Hello there".
  const script: Scripted[] = [];
  const chat: Chat = async (chatRequest, options) => {
    requests.push(chatRequest);
    const onText = options?.onText ?? (() => undefined);
    const next = script.shift();
    if (next) return next(chatRequest, onText);
    onText("Hello");
    onText(" there");
    return answer("Hello there");
  };
  let brain: Brain | { problem: string } = assistant;
  // Tasks started from chat, by a stand-in orchestrator.
  const created: { brief: string; budgetUsd: number; chatId?: string }[] = [];
  let gaps: Gap[] = [];
  const orchestrator = {
    create: (brief: string, budgetUsd: number, _project?: string, chatId?: string) => {
      created.push({ brief, budgetUsd, ...(chatId ? { chatId } : {}) });
      return { id: randomUUID() };
    },
  } as unknown as Orchestrator;
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
  const start = async (message: string, intent = "ask") => {
    const made = await post("/api/chats", { message, intent });
    assert.equal(made.status, 201, made.body);
    return (JSON.parse(made.body) as Thread).chat.id;
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
        brain: () => brain,
        work: { orchestrator, readiness: () => gaps, project: () => "/tmp/shop" },
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

  return {
    storage,
    requests,
    script,
    created,
    setBrain: (next: Brain | { problem: string }) => (brain = next),
    setGaps: (next: Gap[]) => (gaps = next),
    runtime: () => runtime,
    cookie: () => cookie,
    post,
    get,
    thread,
    settled,
    start,
  };
}
