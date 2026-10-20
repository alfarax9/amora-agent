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

test("counts total, done, and open notes", () => {
  const store = seeded("a", "b", "c");
  store.notes[0].done = true;
  assert.deepEqual(call(store, "GET", "/notes/stats"), {
    status: 200,
    body: { total: 3, done: 1, open: 2 },
  });
});

test("counts an empty store as zeros", () => {
  assert.deepEqual(call(createStore(), "GET", "/notes/stats").body, { total: 0, done: 0, open: 0 });
});
