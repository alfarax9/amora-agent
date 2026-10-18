import { subtotal } from "./cart.js";

const round = (amount) => Math.round(amount * 100) / 100;

export function applyDiscount(cart, code) {
  const total = subtotal(cart);
  if (code === "SAVE10") return round(total * 0.9);
  if (code === "FLAT5") return round(Math.max(0, total - 5));
  throw new Error("Unknown code");
}
