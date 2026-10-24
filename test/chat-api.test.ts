import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Brain } from "../src/runtime/brain.ts";
import { answer, assistant, call, chatWorld, eventsOf } from "./chat-fixture.ts";

describe("chat API", () => {
  const world = chatWorld();
  const { requests, script, created, post, get, thread, settled, start } = world;

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
    const stream = await call(world.runtime().port, "GET", `/api/chats/${id}/events`, {
      cookie: world.cookie(),
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
    await post(`/api/chats/${id}/messages`, { message: "And then?", intent: "ask" });
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

  it("takes one message at a time", async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    script.push(async () => (await gate, answer("Done")));
    const id = await start("First");
    const busy = await post(`/api/chats/${id}/messages`, { message: "Second", intent: "ask" });
    assert.equal(busy.status, 409);
    release();
    assert.equal((await settled(id)).messages.length, 2);
  });

  it("answers as the Assistant on its brain, and says when it has none", async () => {
    const overview = JSON.parse((await get("/api/chats")).body) as { brain: Brain };
    assert.deepEqual(overview.brain, assistant);
    const id = await start("Hi");
    assert.equal((await settled(id)).messages[1]?.worker, "assistant");
    world.setBrain({ problem: "Assistant has no model that fits: No model is assigned." });
    const none = await post("/api/chats", { message: "Hi", intent: "ask" });
    assert.equal(none.status, 409);
    assert.match(JSON.parse(none.body).error, /no model that fits.*amora models set global/);
    world.setBrain(assistant);
  });

  it("starts a task from work, as a card after the message that is never edited or retried", async () => {
    world.setGaps([{ problem: "No daily limit is set.", command: "amora budget --daily <usd>" }]);
    const refused = await post("/api/chats", { message: "Add a dark mode toggle", intent: "task" });
    assert.equal(refused.status, 409);
    assert.match(JSON.parse(refused.body).error, /amora budget --daily/);
    world.setGaps([]);
    assert.equal((await post("/api/task-budget", { usd: 0 })).status, 400);
    assert.deepEqual(JSON.parse((await post("/api/task-budget", { usd: 2.5 })).body), { usd: 2.5 });
    const id = await start("Add a dark mode toggle", "auto");
    const shown = await thread(id);
    assert.deepEqual(
      shown.messages.map(({ role, kind, worker }) => [role, kind, worker]),
      [
        ["user", "text", null],
        ["assistant", "card", "planner-decomposer"],
      ],
    );
    assert.deepEqual(created.at(-1), {
      brief: "Add a dark mode toggle",
      budgetUsd: 2.5,
      chatId: id,
    });
    assert.equal(typeof shown.messages[1]?.taskId, "string");
    const edit = { messageId: shown.messages[0]?.id, message: "Add a light mode" };
    assert.equal((await post(`/api/chats/${id}/edit`, edit)).status, 409);
    const retry = await post(`/api/chats/${id}/retry`, { messageId: shown.messages[1]?.id });
    assert.equal(retry.status, 409);
  });

  it("keeps every version: a retry and an edit add siblings, and the branch can switch", async () => {
    const id = await start("Name a colour");
    const first = await settled(id);
    script.push(async () => answer("Blue"));
    await post(`/api/chats/${id}/retry`, { messageId: first.messages[1]?.id });
    const retried = await settled(id);
    assert.deepEqual(
      retried.messages.map(({ text, version, versions }) => [text, version, versions.length]),
      [
        ["Name a colour", 1, 1],
        ["Blue", 2, 2],
      ],
    );
    const edit = { messageId: first.messages[0]?.id, message: "Name a fruit", intent: "ask" };
    await post(`/api/chats/${id}/edit`, edit);
    const edited = await settled(id);
    assert.deepEqual(
      edited.messages.map(({ text, version }) => [text, version]),
      [
        ["Name a fruit", 2],
        ["Hello there", 1],
      ],
    );
    // The edited question went to the model without the replies it replaced.
    const asked = requests.at(-1)?.messages.map(({ content }) => content);
    assert.deepEqual(asked?.slice(1), ["Name a fruit"]);
    // Back to the first question, with the reply it had last.
    await post(`/api/chats/${id}/branch`, { messageId: first.messages[0]?.id });
    assert.deepEqual(
      (await thread(id)).messages.map(({ text }) => text),
      ["Name a colour", "Blue"],
    );
  });

  it("stops a reply and keeps what it wrote so far", async () => {
    script.push(
      (_request, onText) =>
        new Promise((_resolve, reject) => {
          onText("Once upon");
          setTimeout(() => reject(new Error("The reply was stopped.")), 30);
        }),
    );
    const id = await start("Tell a long story");
    await post(`/api/chats/${id}/stop`);
    const stopped = await settled(id);
    assert.deepEqual(
      stopped.messages.map(({ text, status }) => [text, status]),
      [
        ["Tell a long story", "done"],
        ["Once upon", "stopped"],
      ],
    );
  });
});
