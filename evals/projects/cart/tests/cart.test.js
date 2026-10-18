import assert from "node:assert/strict";
import { test } from "node:test";
import { addItem, emptyCart, subtotal } from "../src/cart.js";

test("adds up the items", () => {
  const cart = addItem(addItem(emptyCart(), { sku: "a", name: "A", price: 2 }), {
    sku: "b",
    name: "B",
    price: 3,
    quantity: 2,
  });
  assert.equal(subtotal(cart), 8);
});
