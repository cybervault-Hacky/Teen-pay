const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrDigitsFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

/** Format a whole-rupee amount for display, e.g. 2450 → "₹2,450". */
export function formatINR(amount: number): string {
  return inrFormatter.format(amount);
}

/** Grouped digits only, e.g. 2450 → "2,450" (for paired ₹ glyphs). */
export function formatINRDigits(amount: number): string {
  return inrDigitsFormatter.format(amount);
}

/** Format with an explicit sign for ledger rows: +₹500 / -₹350. */
export function formatINRWithSign(amount: number): string {
  const formatted = inrFormatter.format(Math.abs(amount));
  return amount >= 0 ? `+${formatted}` : `-${formatted}`;
}
