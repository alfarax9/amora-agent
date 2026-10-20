export function mostExpensiveLine(cart) {
  let best = null;
  for (const line of cart.items) {
    if (best === null || line.price * line.quantity > best.price * best.quantity) best = line;
  }
  return best;
}
