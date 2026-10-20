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

test("returns the first n notes", () => {
  assert.deepEqual(
    call(seeded("a", "b", "c"), "GET", "/notes?limit=2").body.map(({ title }) => title),
    ["a", "b"],
  );
  assert.equal(call(seeded("a"), "GET", "/notes?limit=100").body.length, 1);
});

test("refuses a limit outside 1 to 100 or not a whole number", () => {
  for (const limit of ["0", "101", "1.5", "two", ""]) {
    assert.deepEqual(
      call(seeded("a"), "GET", `/notes?limit=${limit}`),
      {
        status: 400,
        body: { error: "limit must be 1 to 100" },
      },
      limit,
    );
  }
});
