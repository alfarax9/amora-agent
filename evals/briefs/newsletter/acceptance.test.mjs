import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { renderPage } = await load("page.js");
const { validateEmail } = await load("newsletter.js");
const html = renderPage();

test("the page has a signup form with a labelled email field and a button", () => {
  assert.match(html, /<form[\s>]/);
  const input = html.match(/<input[^>]*type="email"[^>]*>/);
  assert.ok(input, "an email input");
  const id = input[0].match(/id="([^"]+)"/)?.[1];
  assert.ok(
    id && new RegExp(`<label[^>]*for="${id}"`).test(html),
    "a label tied to the email input",
  );
  assert.match(html, /<button[^>]*>[^<]*\S[^<]*<\/button>/);
});

test("validateEmail accepts a normal address", () => {
  assert.equal(validateEmail("ana@example.com"), true);
  assert.equal(validateEmail("first.last+news@sub.example.org"), true);
});

test("validateEmail rejects empty and malformed addresses", () => {
  for (const bad of [
    "",
    "   ",
    "ana",
    "ana@",
    "@example.com",
    "ana@example",
    "ana example@x.com",
  ]) {
    assert.equal(validateEmail(bad), false, bad);
  }
});

test("keeps the page heading", () => {
  assert.match(html, /<h1>Acme<\/h1>/);
});
