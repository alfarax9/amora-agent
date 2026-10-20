import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const html = renderPage();
const { cookieChoice } = await load("cookies.js");

test("shows the notice with Accept and Decline buttons", () => {
  assert.match(html, /We use cookies/);
  assert.match(html, /<button[^>]*>\s*Accept\s*<\/button>/);
  assert.match(html, /<button[^>]*>\s*Decline\s*<\/button>/);
});

test("records the choice and hides the notice without changing the given state", () => {
  const state = { consent: null, visible: true };
  assert.deepEqual(cookieChoice(state, "accept"), { consent: true, visible: false });
  assert.deepEqual(cookieChoice(state, "decline"), { consent: false, visible: false });
  assert.deepEqual(state, { consent: null, visible: true });
});

test("refuses any other action", () => {
  assert.throws(() => cookieChoice({ consent: null, visible: true }, "maybe"));
});

test("keeps the page heading", () => {
  assert.match(html, /<h1[^>]*>Acme<\/h1>/);
});
