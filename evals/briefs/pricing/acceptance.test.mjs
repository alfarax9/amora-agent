import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const { renderPage } = await load("page.js");
const page = text(renderPage());

test("shows the three plans in order", () => {
  const order = ["Starter", "Team", "Business"].map((name) => page.indexOf(name));
  assert.ok(
    order.every((index) => index >= 0),
    page,
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
});

test("shows each plan's price next to its name", () => {
  assert.match(page, /Starter[^$]*?\bfree\b/i);
  assert.match(page, /Team[^]*?\$12(\.00)?\s*(\/|per)\s*(mo|month)/i);
  assert.match(page, /Business[^]*?\$30(\.00)?\s*(\/|per)\s*(mo|month)/i);
});

test("keeps the page heading", () => {
  assert.match(renderPage(), /<h1>Acme<\/h1>/);
});
