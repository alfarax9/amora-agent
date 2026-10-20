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

test("flips done and back", () => {
  const store = seeded("a");
  assert.deepEqual(call(store, "PATCH", "/notes/1/done"), {
    status: 200,
    body: { id: 1, title: "a", done: true },
  });
  assert.equal(call(store, "PATCH", "/notes/1/done").body.done, false);
});

test("answers 404 for an unknown id", () => {
  assert.deepEqual(call(seeded("a"), "PATCH", "/notes/9/done"), {
    status: 404,
    body: { error: "Not found" },
  });
});
