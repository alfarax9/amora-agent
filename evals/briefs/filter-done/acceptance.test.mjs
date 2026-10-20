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

function withOneDone() {
  const store = seeded("a", "b");
  store.notes[1].done = true;
  return store;
}

test("filters by done", () => {
  assert.deepEqual(
    call(withOneDone(), "GET", "/notes?done=true").body.map(({ title }) => title),
    ["b"],
  );
  assert.deepEqual(
    call(withOneDone(), "GET", "/notes?done=false").body.map(({ title }) => title),
    ["a"],
  );
});

test("refuses other values", () => {
  assert.deepEqual(call(withOneDone(), "GET", "/notes?done=yes"), {
    status: 400,
    body: { error: "done must be true or false" },
  });
});

test("lists everything without a query", () => {
  assert.equal(call(withOneDone(), "GET", "/notes").body.length, 2);
});
