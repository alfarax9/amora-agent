export function emptyCart() {
  return { items: [] };
}

export function addItem(cart, item) {
  const quantity = item.quantity ?? 1;
  if (cart.items.some((line) => line.sku === item.sku)) {
    return {
      items: cart.items.map((line) =>
        line.sku === item.sku ? { ...line, quantity: line.quantity + quantity } : line,
      ),
    };
  }
  return { items: [...cart.items, { ...item, quantity }] };
}

export function subtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
