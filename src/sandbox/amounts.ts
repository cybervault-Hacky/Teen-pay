/**
 * Amount parsing & guards — the domain boundary for every money input.
 *
 * Parsing uses integer math only (never floats). UI validates live with
 * `parseAmountInput`; the ledger engine re-validates paise defensively
 * with `validateTransferPaise`, so rules hold even if the UI is bypassed.
 */

import { formatINR } from "@/lib/format";

/** Smallest transferable amount: ₹1. */
export const MIN_TX_PAISE = 100;

/** Largest single sandbox operation: ₹10,000. */
export const MAX_SANDBOX_TX_PAISE = 1_000_000;

export type AmountParseResult =
  | { ok: true; paise: number }
  | { ok: false; error: string };

/**
 * Parse free-form input ("250", "₹250", "1,000", "250.50") into paise.
 * Rejects blanks, negatives, >2 decimals, zero and out-of-range values
 * with human-readable messages.
 */
export function parseAmountInput(raw: string): AmountParseResult {
  const cleaned = raw.replace(/[\s,₹]/g, "");
  if (cleaned.length === 0) {
    return { ok: false, error: "Enter an amount." };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: "Enter an amount like 250." };
  }
  const [whole, frac = ""] = cleaned.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise <= 0) {
    return { ok: false, error: "Enter an amount." };
  }
  if (paise < MIN_TX_PAISE) {
    return { ok: false, error: `Minimum is ${formatINR(MIN_TX_PAISE)}.` };
  }
  if (paise > MAX_SANDBOX_TX_PAISE) {
    return {
      ok: false,
      error: `Sandbox limit is ${formatINR(MAX_SANDBOX_TX_PAISE)} per transaction.`,
    };
  }
  return { ok: true, paise };
}

/** Defensive re-check for paise arriving at the engine. */
export function validateTransferPaise(paise: number): AmountParseResult {
  if (!Number.isInteger(paise) || paise < MIN_TX_PAISE) {
    return { ok: false, error: `Minimum is ${formatINR(MIN_TX_PAISE)}.` };
  }
  if (paise > MAX_SANDBOX_TX_PAISE) {
    return {
      ok: false,
      error: `Sandbox limit is ${formatINR(MAX_SANDBOX_TX_PAISE)} per transaction.`,
    };
  }
  return { ok: true, paise };
}
