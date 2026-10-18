const maxQuantity = 10;

export function emptyCart() {
  return { items: [] };
}

export function addItem(cart, item) {
  return {
    items: [...cart.items, { ...item, quantity: Math.min(item.quantity ?? 1, maxQuantity) }],
  };
}

export function setQuantity(cart, sku, quantity) {
  if (!Number.isInteger(quantity) || quantity < 0)
    throw new RangeError("Quantity must be a whole number, 0 or more.");
  if (quantity === 0) return { items: cart.items.filter((line) => line.sku !== sku) };
  return {
    items: cart.items.map((line) =>
      line.sku === sku ? { ...line, quantity: Math.min(quantity, maxQuantity) } : line,
    ),
  };
}

export function subtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
