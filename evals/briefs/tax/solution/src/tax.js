export function totalWithTax(cart, rate) {
  const total = cart.items.reduce((sum, item) => {
    const line = item.price * item.quantity;
    return sum + (item.taxExempt ? line : line * (1 + rate));
  }, 0);
  return Math.round(total * 100) / 100;
}
