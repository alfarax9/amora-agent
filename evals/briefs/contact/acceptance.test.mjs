import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const { validateContact } = await load("contact.js");
const valid = { name: "Ana", email: "ana@example.com", message: "Hello there, team!" };

test("the form has labelled name, email, and message fields", () => {
  const html = renderPage();
  assert.match(html, /<form[\s>]/);
  for (const field of ["name", "email", "message"]) {
    const control = html.match(new RegExp(`<(input|textarea)[^>]*name="${field}"[^>]*>`));
    assert.ok(control, field);
    const id = control[0].match(/id="([^"]+)"/)?.[1];
    assert.ok(id && new RegExp(`<label[^>]*for="${id}"`).test(html), `label for ${field}`);
  }
});

test("a valid message has no errors", () => {
  assert.deepEqual(validateContact(valid), {});
});

test("each rule reports its own field", () => {
  assert.deepEqual(Object.keys(validateContact({ ...valid, name: "  " })), ["name"]);
  assert.deepEqual(Object.keys(validateContact({ ...valid, email: "ana@" })), ["email"]);
  assert.deepEqual(Object.keys(validateContact({ ...valid, message: "Too short" })), ["message"]);
  assert.equal(Object.keys(validateContact({ name: "", email: "", message: "" })).length, 3);
});
