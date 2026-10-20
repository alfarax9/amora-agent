import { subtotal } from "./cart.js";

export function shippingCost(cart) {
  const total = subtotal(cart);
  return total > 0 && total < 50 ? 5 : 0;
}
