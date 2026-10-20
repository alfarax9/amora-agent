import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const html = renderPage();

test("starts with a skip link to #content", () => {
  assert.match(html, /^<a[^>]*href="#content"[^>]*>\s*Skip to content\s*<\/a>/i);
});

test("gives the main element the id content", () => {
  assert.match(html, /<main[^>]*id="content"/);
});

test("keeps the page heading", () => {
  assert.match(html, /<h1[^>]*>Acme<\/h1>/);
});
