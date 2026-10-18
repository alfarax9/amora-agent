import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const html = renderPage();

test("shows exactly three quotes, each naming its customer", () => {
  const quotes = [...html.matchAll(/<blockquote[^>]*>([^]*?)<\/blockquote>/g)];
  assert.equal(quotes.length, 3);
  for (const [, body] of quotes) {
    const cite = body.match(/<cite[^>]*>([^<]*\S[^<]*)<\/cite>/);
    assert.ok(cite, body);
  }
});

test("keeps the page heading", () => {
  assert.match(html, /<h1>Acme<\/h1>/);
});
