import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");

test("the footer has a labelled nav with the three links", () => {
  const html = renderPage([], { year: 2031 });
  const footer = html.match(/<footer[^>]*>([^]*?)<\/footer>/);
  assert.ok(footer, "a footer");
  assert.match(footer[1], /<nav[^>]*aria-label="Footer"/);
  for (const href of ["/privacy", "/terms", "/contact"]) {
    assert.match(footer[1], new RegExp(`href="${href}"`));
  }
  assert.match(footer[1], /2031/);
});

test("renderPage still works with no arguments and keeps its heading", () => {
  assert.match(renderPage(), /<h1>Acme<\/h1>/);
});
