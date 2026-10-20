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

test("deletes a note", () => {
  const store = seeded("a", "b");
  assert.deepEqual(call(store, "DELETE", "/notes/1"), { status: 204, body: null });
  assert.deepEqual(
    call(store, "GET", "/notes").body.map(({ title }) => title),
    ["b"],
  );
});

test("answers 404 for an unknown id", () => {
  assert.deepEqual(call(seeded("a"), "DELETE", "/notes/9"), {
    status: 404,
    body: { error: "Not found" },
  });
});
