import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { createStore, handle } = await load("notes.js");
const seeded = (...titles) => {
  const store = createStore();
  for (const title of titles) handle(store, { method: "POST", path: "/notes", body: { title } });
  return store;
};
const call = (store, method, path, body) => handle(store, { method, path, body });

test("renames a note", () => {
  const store = seeded("a");
  assert.deepEqual(call(store, "PUT", "/notes/1", { title: "b" }), {
    status: 200,
    body: { id: 1, title: "b", done: false },
  });
  assert.equal(call(store, "GET", "/notes").body[0].title, "b");
});

test("refuses a missing or blank title", () => {
  for (const body of [{}, { title: " " }]) {
    assert.deepEqual(call(seeded("a"), "PUT", "/notes/1", body), {
      status: 400,
      body: { error: "Title is required" },
    });
  }
});

test("answers 404 for an unknown id", () => {
  assert.deepEqual(call(seeded("a"), "PUT", "/notes/9", { title: "b" }), {
    status: 404,
    body: { error: "Not found" },
  });
});
