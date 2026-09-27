import {
  formatQrPayload,
  parseQrPayload,
  type PeerProfile,
} from "@/domain";
import { findAccount } from "./scope";
import { isEligiblePeer, peerProfileOf, resolvePeer } from "./peer";
import type { SandboxDatabase, SandboxError, SandboxResult } from "./types";

/**
 * TeenPay QR — the sandbox side (Phase 9). Discovery only.
 *
 *   scanned text ─▶ parseQrPayload (strict, untrusted input)
 *                ─▶ TeenPay ID ─▶ directory (resolvePeer: eligibility,
 *                   self, closed…) ─▶ PeerProfile (@handle, name, initials)
 *
 * Nothing here moves money or writes data. The profile only preselects
 * a recipient for the existing Send / Request flows, whose engine
 * re-resolves the TeenPay ID and re-checks everything at confirm. A
 * QR can't say how much to send, whose wallet it is, whether approval
 * is needed or whether the person can receive — all of that comes from
 * current state.
 */

export interface QrIdentity {
  /** The exact text encoded in the QR image. */
  payload: string;
  profile: PeerProfile;
}

const NO_QR: SandboxError = {
  code: "not_permitted",
  message: "Only active TeenPay teen accounts have a TeenPay QR.",
};

/**
 * The viewer's own QR: their public identity only. Deterministic — no
 * timestamp, nonce, balance or id — so it's the same every time.
 * Parents (and closed or walletless accounts) have none: they can't
 * receive TeenPay money.
 */
export function qrIdentityFor(db: SandboxDatabase, viewerId: string): SandboxResult<QrIdentity> {
  const account = findAccount(db, viewerId);
  if (!isEligiblePeer(db, account)) return { ok: false, error: NO_QR };
  return {
    ok: true,
    value: { payload: formatQrPayload(account.username), profile: peerProfileOf(account) },
  };
}

/**
 * Resolves scanned or pasted text to a safe recipient for `viewerId`.
 * Malformed → "This isn't a TeenPay QR code."; not found, closed,
 * parent → "No TeenPay user found."; own code → self (refused).
 */
export function resolveQrRecipient(
  db: SandboxDatabase,
  viewerId: string,
  raw: unknown,
): SandboxResult<PeerProfile> {
  const parsed = parseQrPayload(raw);
  if (!parsed.ok) {
    return { ok: false, error: { code: "invalid_qr", message: parsed.message, field: "recipient" } };
  }
  const resolved = resolvePeer(
    db,
    `@${parsed.teenPayId}`,
    viewerId,
    "This is your own TeenPay QR. You can't pay or request from yourself.",
  );
  return resolved.ok ? { ok: true, value: resolved.profile } : { ok: false, error: resolved.error };
}
