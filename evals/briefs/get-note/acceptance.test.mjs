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

test("returns one note by id", () => {
  const store = seeded("a", "b");
  assert.deepEqual(call(store, "GET", "/notes/2"), {
    status: 200,
    body: { id: 2, title: "b", done: false },
  });
});

test("answers 404 for an unknown id", () => {
  assert.deepEqual(call(seeded("a"), "GET", "/notes/9"), {
    status: 404,
    body: { error: "Not found" },
  });
});

test("still lists every note", () => {
  assert.equal(call(seeded("a", "b"), "GET", "/notes").body.length, 2);
});
