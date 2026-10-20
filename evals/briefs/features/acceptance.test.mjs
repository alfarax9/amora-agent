import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const html = renderPage();

test("lists exactly four features, each with a title and a description", () => {
  const titles = [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>\s*<p[^>]*>([^<]*)<\/p>/g)];
  assert.equal(titles.length, 4);
  for (const [, title, text] of titles) {
    assert.ok(title.trim() && text.trim(), "a title and a description");
  }
  assert.equal((html.match(/<h3[\s>]/g) ?? []).length, 4);
});

test("keeps the page heading", () => {
  assert.match(html, /<h1[^>]*>Acme<\/h1>/);
});
