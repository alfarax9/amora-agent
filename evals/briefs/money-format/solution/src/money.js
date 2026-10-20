function group(whole, separator) {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

export function formatMoney(amount, currency) {
  if (currency === "IDR") return `Rp${group(Math.round(amount).toString(), ".")}`;
  const symbols = { USD: "$", EUR: "€" };
  const symbol = symbols[currency];
  if (!symbol) throw new RangeError(`Unknown currency ${currency}`);
  const [whole, cents] = amount.toFixed(2).split(".");
  return `${symbol}${group(whole, ",")}.${cents}`;
}
