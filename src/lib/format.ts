/**
 * Formatting helpers — the single place where money, dates and counts
 * are turned into display strings. Money is always handled in the
 * smallest currency unit (paise for INR) to avoid float errors.
 */

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrExactFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Format paise as INR, e.g. 245000 -> "₹2,450". */
export function formatINR(paise: number, opts?: { exact?: boolean }): string {
  const rupees = paise / 100;
  return opts?.exact ? inrExactFormatter.format(rupees) : inrFormatter.format(rupees);
}

/**
 * Signed amount for ledger-style rows, e.g. +₹1,000 / −₹349.
 * Uses the proper minus sign (U+2212) for typographic polish.
 */
export function formatSignedINR(paise: number, direction: "in" | "out"): string {
  const sign = direction === "in" ? "+" : "−";
  return `${sign}${formatINR(Math.abs(paise))}`;
}

/** Compact figure for dense UI, e.g. 1250000 -> "₹12.5L"? No — plain compact. */
export function formatCompactNumber(value: number): string {
  return compactFormatter.format(value);
}

/** "Today", "Yesterday", or a short date like "24 Sep". */
export function formatDayLabel(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOf(now).getTime() - startOf(date).getTime()) / 86_400_000,
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Short time, e.g. "6:42 pm". */
export function formatTime(isoDate: string): string {
  return new Date(isoDate)
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
}

/** Percentage with clamping, e.g. progress of a savings goal. */
export function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  const pct = Math.min(100, Math.max(0, (numerator / denominator) * 100));
  return `${Math.round(pct)}%`;
}

/** Initials for avatars, e.g. "Aarav Sharma" -> "AS". */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
