import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());
const { totalWithTax } = await load("tax.js");

test("adds tax at the rate", () => {
  assert.equal(totalWithTax(cartOf({ sku: "a", name: "A", price: 10, quantity: 2 }), 0.2), 24);
});

test("rounds to cents", () => {
  assert.equal(totalWithTax(cartOf({ sku: "a", name: "A", price: 9.99 }), 0.075), 10.74);
});

test("does not tax exempt items", () => {
  const cart = cartOf(
    { sku: "a", name: "A", price: 10 },
    { sku: "b", name: "B", price: 5, taxExempt: true },
  );
  assert.equal(totalWithTax(cart, 0.1), 16);
});
