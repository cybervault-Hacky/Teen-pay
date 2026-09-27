import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import {
  checkUsername,
  formatQrPayload,
  looksLikeInternalId,
  parseQrPayload,
  primaryWalletId,
  QR_PAYLOAD_MAX_LENGTH,
  type QrProblem,
} from "@/domain";
import { qrMatrix, type QrMatrix } from "@/lib/qr-matrix";
import { createAccount } from "@/sandbox/accounts";
import { parseTeenPayId, searchPeers } from "@/sandbox/peer";
import { sendMoneyTransition } from "@/sandbox/peer-transitions";
import { qrIdentityFor, resolveQrRecipient } from "@/sandbox/qr";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID, buildSeedDatabase } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT } from "./helpers/fixtures";

/**
 * Phase 9 — the TeenPay QR identity: a versioned, deterministic,
 * public-only payload; a strict parser for untrusted scans; and
 * resolution through the directory (never from QR fields).
 */

const MEERA_WALLET = primaryWalletId(SEED_PEER_ID);

function withAccountStatus(db: SandboxDatabase, id: string, status: "active" | "suspended" | "closed"): SandboxDatabase {
  return { ...db, accounts: db.accounts.map((a) => (a.id === id ? { ...a, status } : a)) };
}

function withWalletStatus(db: SandboxDatabase, walletId: string, status: "active" | "frozen" | "closed"): SandboxDatabase {
  return { ...db, wallets: db.wallets.map((w) => (w.id === walletId ? { ...w, status } : w)) };
}

/** Renders a module matrix to RGBA pixels (with quiet zone) and decodes it with jsQR. */
function decode(matrix: QrMatrix): string | null {
  const scale = 4;
  const quiet = 4;
  const side = (matrix.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row]![col]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const y = (row + quiet) * scale + dy;
          const x = (col + quiet) * scale + dx;
          const i = (y * side + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(data, side, side)?.data ?? null;
}

describe("QR payload — versioned, deterministic, public identity only", () => {
  it("encodes exactly the TeenPay ID and a version", () => {
    expect(formatQrPayload("meera")).toBe("teenpay://user/@meera?v=1");
    expect(formatQrPayload("@Aarav")).toBe("teenpay://user/@aarav?v=1");
  });

  it("same user → same payload; different users → different payloads", () => {
    expect(formatQrPayload("meera")).toBe(formatQrPayload("meera"));
    expect(formatQrPayload("meera")).not.toBe(formatQrPayload("aarav"));
  });

  it("never carries ids, balances, timestamps or session data", () => {
    const db = buildSeedDatabase();
    const own = qrIdentityFor(db, SEED_TEEN_ID);
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    expect(own.value.payload).toBe("teenpay://user/@aarav?v=1");
    expect(own.value.payload).not.toMatch(/usr_|wal_|fam_|1850|4150|2026|session|token/i);
    expect(Object.keys(own.value.profile).sort()).toEqual(["handle", "initials", "name"]);
    // Deterministic across calls and database snapshots.
    expect(qrIdentityFor(buildSeedDatabase(), SEED_TEEN_ID)).toEqual(own);
  });

  it("refuses to build a code for an invalid or id-shaped identity", () => {
    expect(() => formatQrPayload("usr_aarav")).toThrow();
    expect(() => formatQrPayload("a")).toThrow();
    expect(() => formatQrPayload("bad id")).toThrow();
  });
});

describe("QR image — a real code that decodes back to the payload", () => {
  it("round-trips through an independent decoder (jsQR)", () => {
    for (const payload of [formatQrPayload("aarav"), formatQrPayload("meera")]) {
      expect(decode(qrMatrix(payload))).toBe(payload);
    }
  });

  it("is deterministic, and different payloads give different codes", () => {
    const a = qrMatrix(formatQrPayload("aarav"));
    expect(qrMatrix(formatQrPayload("aarav"))).toEqual(a);
    expect(qrMatrix(formatQrPayload("meera")).modules).not.toEqual(a.modules);
  });
});

describe("QR parser — every scan is untrusted input", () => {
  it("accepts the one valid shape (a trailing newline from a scanner is forgiven)", () => {
    expect(parseQrPayload("teenpay://user/@meera?v=1")).toEqual({ ok: true, teenPayId: "meera", version: 1 });
    expect(parseQrPayload("  teenpay://user/@meera?v=1\n")).toMatchObject({ ok: true, teenPayId: "meera" });
    expect(parseQrPayload("teenpay://user/@kabir.rao_2?v=1")).toMatchObject({ ok: true, teenPayId: "kabir.rao_2" });
  });

  const cases: [string, unknown, QrProblem][] = [
    ["not a string", 42, "empty"],
    ["null", null, "empty"],
    ["empty", "", "empty"],
    ["whitespace", "   ", "empty"],
    ["oversized", `teenpay://user/@meera?v=1${"&".repeat(QR_PAYLOAD_MAX_LENGTH)}`, "too_long"],
    ["space inside", "teenpay://user/@me era?v=1", "invalid_characters"],
    ["look-alike Cyrillic letter", "teenpay://user/@m\u0435era?v=1", "invalid_characters"],
    ["bidi control", "teenpay://user/@\u202emeera?v=1", "invalid_characters"],
    ["another scheme", "https://teenpay.example/@meera?v=1", "not_teenpay"],
    ["upper-case scheme", "TEENPAY://user/@meera?v=1", "not_teenpay"],
    ["another kind", "teenpay://pay/@meera?v=1", "not_teenpay"],
    ["UPI-style", "upi://pay?pa=meera@bank&am=500", "not_teenpay"],
    ["missing identity", "teenpay://user/?v=1", "missing_identity"],
    ["bare @", "teenpay://user/@?v=1", "missing_identity"],
    ["no @", "teenpay://user/meera?v=1", "invalid_identity"],
    ["upper-case ID", "teenpay://user/@Meera?v=1", "invalid_identity"],
    ["too short", "teenpay://user/@me?v=1", "invalid_identity"],
    ["trailing dot", "teenpay://user/@meera.?v=1", "invalid_identity"],
    ["starts with a digit", "teenpay://user/@1meera?v=1", "invalid_identity"],
    ["path traversal", "teenpay://user/@meera/../aarav?v=1", "invalid_identity"],
    ["two identities", "teenpay://user/@meera@aarav?v=1", "invalid_identity"],
    ["account id", "teenpay://user/@usr_meera?v=1", "internal_id"],
    ["wallet id", `teenpay://user/@${MEERA_WALLET}?v=1`, "internal_id"],
    ["family id", "teenpay://user/@fam_kapoor?v=1", "internal_id"],
    ["missing version", "teenpay://user/@meera", "missing_version"],
    ["empty query", "teenpay://user/@meera?", "missing_version"],
    ["empty version", "teenpay://user/@meera?v=", "missing_version"],
    ["unsupported version", "teenpay://user/@meera?v=2", "unsupported_version"],
    ["non-numeric version", "teenpay://user/@meera?v=one", "unexpected_parameter"],
    ["amount parameter", "teenpay://user/@meera?v=1&amount=500", "unexpected_parameter"],
    ["wallet parameter", `teenpay://user/@meera?v=1&wallet=${MEERA_WALLET}`, "unexpected_parameter"],
    ["account parameter", "teenpay://user/@meera?v=1&account=usr_meera", "unexpected_parameter"],
    ["approval parameter", "teenpay://user/@meera?v=1&approved=true", "unexpected_parameter"],
    ["duplicate version", "teenpay://user/@meera?v=1&v=1", "duplicate_parameter"],
    ["second query", "teenpay://user/@meera?v=1?amount=5", "unexpected_parameter"],
    ["percent-encoding", "teenpay://user/@%6Deera?v=1", "invalid_characters"],
    ["fragment", "teenpay://user/@meera?v=1#amount=500", "invalid_characters"],
  ];

  it.each(cases)("rejects %s", (_label, raw, problem) => {
    const result = parseQrPayload(raw);
    expect(result).toMatchObject({ ok: false, problem });
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it("says so plainly — and differently for a newer version", () => {
    expect(parseQrPayload("hello")).toMatchObject({ message: "This isn't a TeenPay QR code." });
    expect(parseQrPayload("teenpay://user/@meera?v=2")).toMatchObject({
      message: "This QR code is from a newer version of TeenPay.",
    });
  });
});

describe("QR resolution — through the directory, against current state", () => {
  const db = buildSeedDatabase();

  it("resolves an eligible teen to a display-safe profile", () => {
    const result = resolveQrRecipient(db, SEED_TEEN_ID, "teenpay://user/@meera?v=1");
    expect(result).toEqual({ ok: true, value: { handle: "@meera", name: "Meera Kapoor", initials: "MK" } });
  });

  it("refuses your own code", () => {
    const result = resolveQrRecipient(db, SEED_TEEN_ID, formatQrPayload("aarav"));
    expect(result).toMatchObject({ ok: false, error: { code: "self_transfer" } });
  });

  it("unknown, parent, closed account and closed wallet all read 'No TeenPay user found.'", () => {
    const notFound = { ok: false, error: { code: "unknown_recipient", message: "No TeenPay user found." } };
    expect(resolveQrRecipient(db, SEED_TEEN_ID, "teenpay://user/@nobody?v=1")).toMatchObject(notFound);
    expect(resolveQrRecipient(db, SEED_TEEN_ID, "teenpay://user/@priya?v=1")).toMatchObject(notFound);
    const closedAccount = withAccountStatus(db, SEED_PEER_ID, "closed");
    expect(resolveQrRecipient(closedAccount, SEED_TEEN_ID, "teenpay://user/@meera?v=1")).toMatchObject(notFound);
    const closedWallet = withWalletStatus(db, MEERA_WALLET, "closed");
    expect(resolveQrRecipient(closedWallet, SEED_TEEN_ID, "teenpay://user/@meera?v=1")).toMatchObject(notFound);
  });

  it("malformed or tampered codes are invalid_qr — never resolved", () => {
    for (const raw of ["teenpay://user/@usr_meera?v=1", "teenpay://user/@meera?v=1&amount=1", "garbage"]) {
      expect(resolveQrRecipient(db, SEED_TEEN_ID, raw)).toMatchObject({ ok: false, error: { code: "invalid_qr" } });
    }
  });

  it("a frozen recipient resolves (a real user) but can't be paid — the engine decides at send time", () => {
    const frozen = withWalletStatus(db, MEERA_WALLET, "frozen");
    const resolved = resolveQrRecipient(frozen, SEED_TEEN_ID, "teenpay://user/@meera?v=1");
    expect(resolved.ok).toBe(true);
    const sent = sendMoneyTransition(frozen, {
      actorId: SEED_TEEN_ID, at: AT, recipient: resolved.ok ? resolved.value.handle : "", amount: 100, idempotencyKey: "snd_qr_frozen",
    });
    expect(sent.result).toMatchObject({ ok: false, error: { code: "wallet_frozen", message: "@meera can't receive money right now. Nothing was sent." } });
    expect(sent.db).toBe(frozen);
  });

  it("parents and closed accounts have no QR of their own", () => {
    expect(qrIdentityFor(db, SEED_PARENT_ID)).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(qrIdentityFor(withAccountStatus(db, SEED_TEEN_ID, "closed"), SEED_TEEN_ID).ok).toBe(false);
    expect(qrIdentityFor(db, "usr_ghost").ok).toBe(false);
  });
});

describe("internal ids are never an identity", () => {
  it("new TeenPay IDs can't look like internal ids", () => {
    for (const name of ["usr_meera", "wal_usr_x", "fam_kapoor", "ctc_abc123", "prq_x"]) {
      expect(looksLikeInternalId(name)).toBe(true);
      expect(checkUsername(name).problem).toBe("reserved");
    }
    expect(looksLikeInternalId("meera")).toBe(false);
    expect(looksLikeInternalId("user_one")).toBe(false);
    const made = createAccount(buildSeedDatabase(), { role: "teen", displayName: "Sneaky", username: "usr_aarav" }, AT);
    expect("code" in made).toBe(true);
  });

  it("the directory refuses id-shaped lookups and searches", () => {
    const db = buildSeedDatabase();
    for (const raw of ["usr_meera", "@usr_meera", MEERA_WALLET, "sandbox:usr_meera"]) {
      expect(parseTeenPayId(raw)).toBeNull();
      expect(searchPeers(db, SEED_TEEN_ID, raw)).toEqual([]);
    }
  });
});
