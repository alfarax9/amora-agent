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

test("finds notes by part of the title, ignoring case", () => {
  const store = seeded("Buy milk", "Call Ana", "buy bread");
  assert.deepEqual(
    call(store, "GET", "/notes?q=BUY").body.map(({ title }) => title),
    ["Buy milk", "buy bread"],
  );
});

test("decodes the query", () => {
  const store = seeded("Call Ana", "Call Budi");
  assert.deepEqual(
    call(store, "GET", "/notes?q=call%20ana").body.map(({ title }) => title),
    ["Call Ana"],
  );
});

test("returns nothing when no title matches", () => {
  assert.deepEqual(call(seeded("a"), "GET", "/notes?q=zzz").body, []);
});
