import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());

test("adding the same sku twice makes one line with both quantities", () => {
  const cart = cartOf(
    { sku: "a", name: "A", price: 2 },
    { sku: "a", name: "A", price: 2, quantity: 3 },
  );
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 4);
});

test("different skus stay separate lines", () => {
  assert.equal(
    cartOf({ sku: "a", name: "A", price: 2 }, { sku: "b", name: "B", price: 2 }).items.length,
    2,
  );
});

test("the given cart is unchanged", () => {
  const before = cartOf({ sku: "a", name: "A", price: 2 });
  const snapshot = JSON.stringify(before);
  addItem(before, { sku: "a", name: "A", price: 2 });
  assert.equal(JSON.stringify(before), snapshot);
});
