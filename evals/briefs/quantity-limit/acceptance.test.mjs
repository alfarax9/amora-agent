import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());
const { setQuantity } = await load("cart.js");
const one = () => cartOf({ sku: "a", name: "A", price: 2 });

test("addItem caps a line at ten", () => {
  assert.equal(cartOf({ sku: "a", name: "A", price: 2, quantity: 25 }).items[0].quantity, 10);
});

test("setQuantity sets, caps, and removes", () => {
  assert.equal(setQuantity(one(), "a", 4).items[0].quantity, 4);
  assert.equal(setQuantity(one(), "a", 99).items[0].quantity, 10);
  assert.equal(setQuantity(one(), "a", 0).items.length, 0);
});

test("setQuantity refuses negative and fractional quantities", () => {
  assert.throws(() => setQuantity(one(), "a", -1), RangeError);
  assert.throws(() => setQuantity(one(), "a", 1.5), RangeError);
});

test("the given cart is unchanged", () => {
  const cart = one();
  setQuantity(cart, "a", 5);
  assert.equal(cart.items[0].quantity, 1);
});
