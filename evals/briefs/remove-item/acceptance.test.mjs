import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());
const { removeItem } = await load("cart.js");

test("removes the line with that sku", () => {
  const cart = cartOf({ sku: "a", name: "A", price: 2 }, { sku: "b", name: "B", price: 3 });
  assert.deepEqual(
    removeItem(cart, "a").items.map(({ sku }) => sku),
    ["b"],
  );
});

test("leaves the given cart unchanged", () => {
  const cart = cartOf({ sku: "a", name: "A", price: 2 });
  removeItem(cart, "a");
  assert.equal(cart.items.length, 1);
});

test("keeps every line when the sku is not in the cart", () => {
  const cart = cartOf({ sku: "a", name: "A", price: 2 });
  assert.deepEqual(removeItem(cart, "z").items, cart.items);
});
