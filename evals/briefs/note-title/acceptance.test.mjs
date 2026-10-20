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

test("refuses a missing or blank title", () => {
  const store = createStore();
  for (const body of [{}, { title: "" }, { title: "   " }]) {
    assert.deepEqual(call(store, "POST", "/notes", body), {
      status: 400,
      body: { error: "Title is required" },
    });
  }
  assert.equal(call(store, "GET", "/notes").body.length, 0);
});

test("trims the title", () => {
  assert.equal(
    call(createStore(), "POST", "/notes", { title: "  Buy milk " }).body.title,
    "Buy milk",
  );
});
