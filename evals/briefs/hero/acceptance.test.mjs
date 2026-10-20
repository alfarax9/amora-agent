import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const html = renderPage();

test("has a call to action linking to /signup", () => {
  const link = html.match(/<a[^>]*href="\/signup"[^>]*>([^<]*)<\/a>/);
  assert.ok(link, "a link to /signup");
  assert.match(link[1], /get started/i);
});

// A hero usually owns the page's main heading, so any heading level counts,
// and replacing the old title is allowed: the brief asks only for "a heading".
test("has a heading and a sentence", () => {
  assert.match(html, /<h([1-6])[^>]*>[^<]*\S[^<]*<\/h\1>/);
  assert.match(html, /<p[^>]*>[^<]*\S[^<]*<\/p>/);
});
