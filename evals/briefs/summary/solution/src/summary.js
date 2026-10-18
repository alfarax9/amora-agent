import { subtotal } from "./cart.js";

export function cartSummary(cart) {
  const units = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  if (units === 0) return "Your cart is empty";
  return `${units} ${units === 1 ? "item" : "items"}, $${subtotal(cart).toFixed(2)}`;
}
