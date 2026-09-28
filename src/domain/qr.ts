import { checkUsername, normalizeUsername } from "./account";
import { looksLikeInternalId } from "./identity";

/**
 * Domain: the TeenPay QR code (Phase 9).
 *
 * A TeenPay QR is a **public identity**, never a payment credential.
 * It says "this is @meera" and nothing else — no amount, no account,
 * wallet or family id, no balance, no timestamp, no session. Scanning
 * one only *selects* a recipient; the person still enters an amount,
 * reviews and confirms, and the existing peer engine decides
 * everything (eligibility, guardian rules, balance) from current
 * state.
 *
 * Format (version 1), deterministic — the same user always gets the
 * same string:
 *
 *     teenpay://user/@meera?v=1
 *
 *   · scheme + kind  `teenpay://user/` (lowercase, exact)
 *   · identity       `@` + the TeenPay ID (username grammar)
 *   · version        exactly one query parameter, `v`, currently `1`
 *
 * The parser is strict and total: anything else — another scheme,
 * extra or repeated parameters, percent-encoding, an unknown version,
 * something shaped like an internal id, oversized input — is rejected
 * with a reason. A future version bumps `v`; old apps then say
 * "needs a newer version" instead of guessing.
 */

export const QR_PAYLOAD_VERSION = 1;
export const QR_PAYLOAD_PREFIX = "teenpay://user/";
/** Generous for the grammar (a 20-char ID yields 38 chars); bounds work. */
export const QR_PAYLOAD_MAX_LENGTH = 128;

export type QrProblem =
  | "empty"
  | "too_long"
  | "invalid_characters"
  | "not_teenpay"
  | "missing_identity"
  | "invalid_identity"
  | "internal_id"
  | "missing_version"
  | "unsupported_version"
  | "unexpected_parameter"
  | "duplicate_parameter";

export type QrParseResult =
  | { ok: true; teenPayId: string; version: typeof QR_PAYLOAD_VERSION }
  | { ok: false; problem: QrProblem; message: string };

const NOT_A_TEENPAY_QR = "This isn't a TeenPay QR code.";

const QR_MESSAGES: Record<QrProblem, string> = {
  empty: NOT_A_TEENPAY_QR,
  too_long: NOT_A_TEENPAY_QR,
  invalid_characters: NOT_A_TEENPAY_QR,
  not_teenpay: NOT_A_TEENPAY_QR,
  missing_identity: NOT_A_TEENPAY_QR,
  invalid_identity: NOT_A_TEENPAY_QR,
  internal_id: NOT_A_TEENPAY_QR,
  missing_version: NOT_A_TEENPAY_QR,
  unexpected_parameter: NOT_A_TEENPAY_QR,
  duplicate_parameter: NOT_A_TEENPAY_QR,
  unsupported_version: "This QR code is from a newer version of TeenPay.",
};

/** The one QR string for a TeenPay ID. Throws on an invalid ID (a bug). */
export function formatQrPayload(teenPayId: string): string {
  const username = normalizeUsername(teenPayId);
  const check = checkUsername(username);
  if (check.problem !== null || looksLikeInternalId(username)) {
    throw new Error("Only a valid TeenPay ID can be put in a QR code.");
  }
  return `${QR_PAYLOAD_PREFIX}@${username}?v=${QR_PAYLOAD_VERSION}`;
}

function problem(p: QrProblem): QrParseResult {
  return { ok: false, problem: p, message: QR_MESSAGES[p] };
}

/**
 * Parses untrusted scanned or pasted text. Returns the TeenPay ID the
 * code names — which the caller must still look up in the directory
 * (it may not exist, may be closed, may be the scanner themself).
 */
export function parseQrPayload(raw: unknown): QrParseResult {
  if (typeof raw !== "string") return problem("empty");
  // Scanners sometimes add a trailing newline; nothing else is forgiven.
  const text = raw.trim();
  if (text.length === 0) return problem("empty");
  if (text.length > QR_PAYLOAD_MAX_LENGTH) return problem("too_long");
  // Printable ASCII only: no spaces, control, bidi or look-alike characters.
  if (!/^[\x21-\x7e]+$/.test(text)) return problem("invalid_characters");
  if (!text.startsWith(QR_PAYLOAD_PREFIX)) return problem("not_teenpay");

  const rest = text.slice(QR_PAYLOAD_PREFIX.length);
  if (rest.includes("#") || rest.includes("%")) return problem("invalid_characters");
  const parts = rest.split("?");
  if (parts.length > 2) return problem("unexpected_parameter");
  const [path = "", query] = parts;

  if (path.length === 0 || path === "@") return problem("missing_identity");
  if (!path.startsWith("@") || path.includes("/") || path.slice(1).includes("@")) {
    return problem("invalid_identity");
  }
  const identity = path.slice(1);
  if (looksLikeInternalId(identity)) return problem("internal_id");
  // Exact grammar, already normalized (lowercase): the QR is generated,
  // so "@Meera" or "@meera." is not ours.
  const check = checkUsername(identity);
  if (normalizeUsername(identity) !== identity || (check.problem !== null && check.problem !== "reserved")) {
    return problem("invalid_identity");
  }

  if (query === undefined || query.length === 0) return problem("missing_version");
  const seen = new Set<string>();
  let version: string | null = null;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    if (seen.has(key)) return problem("duplicate_parameter");
    seen.add(key);
    if (key !== "v") return problem("unexpected_parameter");
    version = value;
  }
  if (version === null || version.length === 0) return problem("missing_version");
  if (version !== String(QR_PAYLOAD_VERSION)) {
    return problem(/^\d{1,4}$/.test(version) ? "unsupported_version" : "unexpected_parameter");
  }
  return { ok: true, teenPayId: identity, version: QR_PAYLOAD_VERSION };
}
