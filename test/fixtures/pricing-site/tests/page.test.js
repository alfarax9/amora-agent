import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPage } from "../src/page.js";

test("renders the page heading", () => {
  assert.match(renderPage(), /<h1>Acme<\/h1>/);
});
