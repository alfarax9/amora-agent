import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const { toggleFaq } = await load("faq.js");
const html = renderPage();

test("has at least three questions that control hidden answers", () => {
  const buttons = [...html.matchAll(/<button[^>]*aria-controls="([^"]+)"[^>]*>/g)];
  assert.ok(buttons.length >= 3, `${buttons.length} questions`);
  for (const [button, id] of buttons) {
    assert.match(button, /aria-expanded="false"/);
    const answer = html.match(new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`));
    assert.ok(answer, `answer ${id}`);
    assert.match(answer[0], /\bhidden\b/);
  }
});

test("toggleFaq flips one flag and leaves the input unchanged", () => {
  const open = [false, false, false];
  assert.deepEqual(toggleFaq(open, 1), [false, true, false]);
  assert.deepEqual(toggleFaq([true, false], 0), [false, false]);
  assert.deepEqual(open, [false, false, false]);
});

test("keeps the page heading", () => {
  assert.match(html, /<h1>Acme<\/h1>/);
});
