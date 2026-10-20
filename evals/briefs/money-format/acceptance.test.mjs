import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { formatMoney } = await load("money.js");

test("formats dollars and euros with two decimals and comma thousands", () => {
  assert.equal(formatMoney(1234.5, "USD"), "$1,234.50");
  assert.equal(formatMoney(1234.5, "EUR"), "€1,234.50");
  assert.equal(formatMoney(0.5, "USD"), "$0.50");
});

test("formats rupiah without decimals and with dot thousands", () => {
  assert.equal(formatMoney(1234500, "IDR"), "Rp1.234.500");
  assert.equal(formatMoney(999, "IDR"), "Rp999");
});

test("refuses other currencies", () => {
  assert.throws(() => formatMoney(1, "GBP"), RangeError);
});
