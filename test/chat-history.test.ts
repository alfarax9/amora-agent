import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spentSince } from "../src/runtime/task-store.ts";
import { chatWorld } from "./chat-fixture.ts";

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
});
