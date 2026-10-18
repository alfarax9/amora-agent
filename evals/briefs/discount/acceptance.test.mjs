import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());
const { applyDiscount } = await load("discount.js");

test("SAVE10 takes ten percent off", () => {
  assert.equal(
    applyDiscount(cartOf({ sku: "a", name: "A", price: 25, quantity: 2 }), "SAVE10"),
    45,
  );
  assert.equal(applyDiscount(cartOf({ sku: "a", name: "A", price: 3.33 }), "SAVE10"), 3);
});

test("FLAT5 takes five dollars off but never goes below zero", () => {
  assert.equal(applyDiscount(cartOf({ sku: "a", name: "A", price: 12 }), "FLAT5"), 7);
  assert.equal(applyDiscount(cartOf({ sku: "a", name: "A", price: 3 }), "FLAT5"), 0);
});

test("an unknown code is refused", () => {
  assert.throws(
    () => applyDiscount(cartOf({ sku: "a", name: "A", price: 3 }), "FREE"),
    /Unknown code/,
  );
});
