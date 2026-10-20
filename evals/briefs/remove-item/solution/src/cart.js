export function emptyCart() {
  return { items: [] };
}

export function addItem(cart, item) {
  return { items: [...cart.items, { ...item, quantity: item.quantity ?? 1 }] };
}

export function subtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function removeItem(cart, sku) {
  return { items: cart.items.filter((line) => line.sku !== sku) };
}
