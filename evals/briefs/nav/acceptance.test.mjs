import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const html = renderPage();

test("has a nav labelled Main with the four links", () => {
  const nav = html.match(/<nav[^>]*aria-label="Main"[^>]*>([^]*?)<\/nav>/);
  assert.ok(nav, "a nav labelled Main");
  for (const href of ["/", "/pricing", "/blog", "/login"]) {
    assert.match(nav[1], new RegExp(`href="${href}"`));
  }
});

test("puts the nav before the page heading", () => {
  assert.ok(html.indexOf("<nav") >= 0 && html.indexOf("<nav") < html.indexOf("<h1"));
});

test("keeps the page heading", () => {
  assert.match(html, /<h1[^>]*>Acme<\/h1>/);
});
