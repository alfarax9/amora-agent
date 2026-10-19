// Dollars to the cent for ordinary amounts. A smaller amount, such as a tiny
// budget or one review's cost, keeps its first two significant digits, since
// "$0.00" would hide it.
export function formatUsd(amount: number): string {
  if (amount === 0 || Math.abs(amount) >= 0.01) return `$${amount.toFixed(2)}`;
  const decimals = 1 - Math.floor(Math.log10(Math.abs(amount)));
  return `$${amount.toFixed(decimals).replace(/0+$/, "")}`;
}
