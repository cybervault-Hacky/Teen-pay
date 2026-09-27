/**
 * Deterministic, absolute date formatting.
 *
 * Two rules keep rendering stable everywhere:
 * · Server-rendered output never says "Today" / "Yesterday" —
 *   relative labels depend on wall-clock time and would
 *   desynchronize server and client. `relativeDayLabel` exists for
 *   client-only screens (behind the auth gate), which pass "now" in
 *   explicitly and always keep the absolute date next to it.
 * · Always render in Asia/Kolkata, the product's timezone, so the
 *   same ISO instant always produces the same string regardless of
 *   the viewer's device timezone.
 */
const TIME_ZONE = "Asia/Kolkata";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const fullDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
});

/** "25 Sep, 9:00 am" */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

/** "Friday, 25 September 2026, 9:00 am" */
export function formatFullDateTime(iso: string): string {
  return fullDateTimeFormatter.format(new Date(iso));
}

/** "25 Sep" — used as group labels in the activity feed. */
export function formatDayLabel(iso: string): string {
  return dayLabelFormatter.format(new Date(iso));
}

/** Calendar key (in the product timezone) used to group rows by day. */
export function dayKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return parts; // "YYYY-MM-DD"
}

/**
 * "Today" / "Yesterday" relative to `nowIso` (product timezone), or
 * null for older days. Client-only: callers pass "now" explicitly.
 */
export function relativeDayLabel(iso: string, nowIso: string): "Today" | "Yesterday" | null {
  const day = dayKey(iso);
  if (day === dayKey(nowIso)) return "Today";
  const yesterday = new Date(Date.parse(nowIso) - 24 * 60 * 60 * 1000).toISOString();
  return day === dayKey(yesterday) ? "Yesterday" : null;
}

/** Initials for avatars, e.g. "Riya Patel" → "RP". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || name.slice(0, 2).toUpperCase();
}

const dateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "2026-09-28" → "Mon, Sep 28" (calendar key in the product timezone). */
export function formatDateKey(key: string): string {
  // Noon UTC is the same calendar day in Asia/Kolkata.
  return dateKeyFormatter.format(new Date(`${key}T12:00:00Z`));
}

const longDateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "2026-11-30" → "Nov 30, 2026" (calendar key in the product timezone). */
export function formatLongDateKey(key: string): string {
  return longDateKeyFormatter.format(new Date(`${key}T12:00:00Z`));
}
