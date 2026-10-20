import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());
const { subtotal } = await load("cart.js");

test("takes ten percent off a line of ten or more units", () => {
  assert.equal(subtotal(cartOf({ sku: "a", name: "A", price: 3, quantity: 10 })), 27);
});

test("leaves smaller lines alone", () => {
  assert.equal(subtotal(cartOf({ sku: "a", name: "A", price: 3, quantity: 9 })), 27);
  assert.equal(
    subtotal(
      cartOf({ sku: "a", name: "A", price: 3, quantity: 10 }, { sku: "b", name: "B", price: 2 }),
    ),
    29,
  );
});

test("rounds to cents", () => {
  assert.equal(subtotal(cartOf({ sku: "a", name: "A", price: 1.11, quantity: 10 })), 9.99);
});
