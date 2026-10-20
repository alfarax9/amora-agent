import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());
const { shippingCost } = await load("shipping.js");

test("charges 5 below 50", () => {
  assert.equal(shippingCost(cartOf({ sku: "a", name: "A", price: 49.99 })), 5);
});

test("is free from 50 up", () => {
  assert.equal(shippingCost(cartOf({ sku: "a", name: "A", price: 25, quantity: 2 })), 0);
  assert.equal(shippingCost(cartOf({ sku: "a", name: "A", price: 80 })), 0);
});

test("is free for an empty cart", () => {
  assert.equal(shippingCost(emptyCart()), 0);
});
