import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createTask, spentSince } from "../src/runtime/task-store.ts";
import { call, chatWorld } from "./chat-fixture.ts";

describe("chat history, artifacts, search, and the app's pages", () => {
  const world = chatWorld();
  const { storage, post, get, thread, settled, start } = world;

  it("renames, stars, and exports a chat", async () => {
    const id = await start("Hi");
    await settled(id);
    await post(`/api/chats/${id}/rename`, { title: "Greetings" });
    await post(`/api/chats/${id}/star`, { starred: true });
    const shown = await thread(id);
    assert.equal(shown.chat.title, "Greetings");
    assert.equal(shown.chat.starred, true);
    const exported = JSON.parse((await get(`/api/chats/${id}/export?format=markdown`)).body) as {
      filename: string;
      content: string;
    };
    assert.equal(exported.filename, "Greetings.md");
    assert.equal(
      exported.content,
      "# Greetings\n\n**You**\n\nHi\n\n**assistant**\n\nHello there\n",
    );
  });

  it("stops at the daily limit", async () => {
    storage.setSetting("budgets", { dailyUsd: 0.001 });
    const refused = await post("/api/chats", { message: "Hi" });
    assert.equal(refused.status, 409);
    assert.match(JSON.parse(refused.body).error, /spending limit/);
    storage.setSetting("budgets", { dailyUsd: 100 });
  });

  it("moves a deleted chat to the trash, and emptying it keeps what it cost", async () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const id = await start("Forget this");
    await settled(id);
    const spent = spentSince(storage, midnight);
    const deleted = JSON.parse((await post(`/api/chats/${id}/delete`)).body) as {
      chats: { id: string }[];
      trash: { id: string }[];
    };
    assert.ok(!deleted.chats.some((listed) => listed.id === id));
    assert.ok(deleted.trash.some((trashed) => trashed.id === id));
    assert.equal((await get(`/api/chats/${id}`)).status, 404);
    await post(`/api/chats/${id}/restore`);
    assert.equal((await get(`/api/chats/${id}`)).status, 200);
    await post(`/api/chats/${id}/delete`);
    await post("/api/chats/trash/empty");
    assert.equal(spentSince(storage, midnight), spent);
    const words = storage.database
      .prepare("SELECT text FROM chat_messages WHERE chat_id = ?")
      .all(id) as { text: string }[];
    assert.ok(words.every(({ text }) => text === ""));
    await post(`/api/chats/${id}/restore`);
    assert.equal((await get(`/api/chats/${id}`)).status, 404);
  });

  it("keeps artifacts with their versions, and finds chats, tasks, and artifacts", async () => {
    const made = await post("/api/artifacts", {
      title: "Tax helper",
      kind: "code",
      language: "js",
      content: "export const tax = (n) => n * 0.11;",
    });
    assert.equal(made.status, 201);
    const { artifact } = JSON.parse(made.body) as { artifact: { id: string } };
    const next = { content: "export const vat = (n) => n * 0.12;" };
    await post(`/api/artifacts/${artifact.id}/versions`, next);
    const shown = JSON.parse((await get(`/api/artifacts/${artifact.id}`)).body) as {
      versions: { version: number }[];
    };
    assert.deepEqual(
      shown.versions.map(({ version }) => version),
      [1, 2],
    );
    const key = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;
    assert.equal((await post("/api/artifacts", { title: "k", content: key })).status, 400);
    const chatId = await start("What is a closure in JavaScript?");
    await settled(chatId);
    createTask(storage, "Build a closure explainer page", 1);
    const hits = async (q: string) => {
      const found = await get(`/api/search?q=${encodeURIComponent(q)}`);
      return (JSON.parse(found.body) as { hits: { kind: string; ref: string }[] }).hits;
    };
    const closure = await hits("closure");
    assert.ok(closure.some(({ kind, ref }) => kind === "chat" && ref === chatId));
    assert.ok(closure.some(({ kind }) => kind === "task"));
    assert.deepEqual(
      (await hits("vat")).map(({ kind }) => kind),
      ["artifact"],
    );
    assert.deepEqual(await hits('"*'), []);
  });

  it("serves the app's pages on their paths, after sign-in only", async () => {
    for (const path of [`/chat/${randomUUID()}`, "/code", "/agency/workers", "/settings"]) {
      const page = await get(path);
      assert.equal(page.status, 200, path);
      assert.match(page.body, /<div class="app"/);
    }
    assert.equal((await get("/agency/nope")).status, 404);
    assert.equal((await call(world.runtime().port, "GET", "/code")).status, 401);
  });
});
