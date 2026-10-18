import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());
const { cartSummary } = await load("summary.js");

test("counts units and shows the subtotal with two decimals", () => {
  const cart = cartOf(
    { sku: "a", name: "A", price: 7.5, quantity: 2 },
    { sku: "b", name: "B", price: 12.5 },
  );
  assert.equal(cartSummary(cart), "3 items, $27.50");
});

test("uses the singular for one unit", () => {
  assert.equal(cartSummary(cartOf({ sku: "a", name: "A", price: 4 })), "1 item, $4.00");
});

test("says so when the cart is empty", () => {
  assert.equal(cartSummary(emptyCart()), "Your cart is empty");
});
