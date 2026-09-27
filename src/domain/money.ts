/**
 * Domain: money values — the one place amounts are validated.
 *
 * Sandbox money is whole rupees: 1 unit = ₹1. There are no minor
 * units and no floating-point money anywhere. Every engine path
 * (and every input's live hint) asks `checkMoney`; nothing else
 * decides whether a number is a valid amount.
 */
export type CurrencyCode = "INR";

/** The only currency this phase supports. */
export const SANDBOX_CURRENCY: CurrencyCode = "INR";

export const SUPPORTED_CURRENCIES: readonly string[] = [SANDBOX_CURRENCY];

/** Smallest movable amount. */
export const MIN_SANDBOX_AMOUNT = 1;

/** Sandbox guard: no single move may exceed this. */
export const MAX_SANDBOX_AMOUNT = 10_000;

export type MoneyProblem =
  | "not_a_number"
  | "not_finite"
  | "not_integer"
  | "unsafe_integer"
  | "not_positive"
  | "above_maximum"
  | "unsupported_currency";

export interface MoneyCheckOptions {
  /** Defaults to INR. Anything else is rejected. */
  currency?: string;
  /** Defaults to MAX_SANDBOX_AMOUNT. */
  max?: number;
}

/**
 * Why `amount` isn't a valid sandbox amount, or null when it is.
 * Rejects NaN, ±Infinity, fractions (10.5, 99.99), unsafe integers,
 * zero/negatives, amounts above the cap, and unsupported currencies.
 */
export function checkMoney(
  amount: unknown,
  options: MoneyCheckOptions = {},
): MoneyProblem | null {
  const currency = options.currency ?? SANDBOX_CURRENCY;
  if (!SUPPORTED_CURRENCIES.includes(currency)) return "unsupported_currency";
  if (typeof amount !== "number" || Number.isNaN(amount)) return "not_a_number";
  if (!Number.isFinite(amount)) return "not_finite";
  if (!Number.isInteger(amount)) return "not_integer";
  if (!Number.isSafeInteger(amount)) return "unsafe_integer";
  if (amount < MIN_SANDBOX_AMOUNT) return "not_positive";
  if (amount > (options.max ?? MAX_SANDBOX_AMOUNT)) return "above_maximum";
  return null;
}

export function isValidMoney(amount: unknown, options?: MoneyCheckOptions): amount is number {
  return checkMoney(amount, options) === null;
}
