import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Hidden acceptance test: neither AMORA nor the baseline sees it. It checks
// only what the brief asks for, through the project's exported functions.
const load = (file) => import(pathToFileURL(join(process.env.PROJECT, "src", file)).href);
const { addItem, emptyCart } = await load("cart.js");
const cartOf = (...items) => items.reduce((cart, item) => addItem(cart, item), emptyCart());
const { mostExpensiveLine } = await load("insights.js");

test("returns the line with the highest total", () => {
  const cart = cartOf(
    { sku: "a", name: "A", price: 10 },
    { sku: "b", name: "B", price: 4, quantity: 3 },
  );
  assert.equal(mostExpensiveLine(cart).sku, "b");
});

test("prefers the first line on a tie", () => {
  const cart = cartOf(
    { sku: "a", name: "A", price: 6 },
    { sku: "b", name: "B", price: 3, quantity: 2 },
  );
  assert.equal(mostExpensiveLine(cart).sku, "a");
});

test("returns null for an empty cart", () => {
  assert.equal(mostExpensiveLine(emptyCart()), null);
});
