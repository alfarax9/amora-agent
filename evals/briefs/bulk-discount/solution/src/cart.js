export function emptyCart() {
  return { items: [] };
}

export function addItem(cart, item) {
  return { items: [...cart.items, { ...item, quantity: item.quantity ?? 1 }] };
}

export function subtotal(cart) {
  const total = cart.items.reduce((sum, item) => {
    const line = item.price * item.quantity;
    return sum + (item.quantity >= 10 ? line * 0.9 : line);
  }, 0);
  return Math.round(total * 100) / 100;
}
