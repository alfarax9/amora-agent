import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, handle } from "../src/notes.js";

test("creates a note and lists it", () => {
  const store = createStore();
  const created = handle(store, { method: "POST", path: "/notes", body: { title: "Buy milk" } });
  assert.equal(created.status, 201);
  assert.deepEqual(handle(store, { method: "GET", path: "/notes" }).body, [
    { id: 1, title: "Buy milk", done: false },
  ]);
});
