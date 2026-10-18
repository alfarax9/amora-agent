// A shopping cart as plain data, so it can be tested without a browser. Every
// function returns a new cart and leaves the one it was given unchanged.
export function emptyCart() {
  return { items: [] };
}

// An item is { sku, name, price, quantity }; quantity defaults to 1.
export function addItem(cart, item) {
  return { items: [...cart.items, { ...item, quantity: item.quantity ?? 1 }] };
}

export function subtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
