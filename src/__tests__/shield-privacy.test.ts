import { describe, expect, it } from "vitest";
import {
  assessRequestCreateSafety,
  assessRequestSafety,
  assessSendSafety,
  shieldSettingsFor,
  updateShieldSettingsTransition,
} from "@/sandbox/shield";
import { createMoneyRequestTransition } from "@/sandbox/peer-transitions";
import { isSandboxDatabase } from "@/sandbox/persistence";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID, buildSeedDatabase } from "@/sandbox/seed";
import type { SandboxDatabase, SandboxResult } from "@/sandbox/types";
import { linkedDatabase } from "./helpers/fixtures";

/**
 * Phase 14 privacy boundary: the Safety Shield is derived context, not
 * a dossier. Assessments are display-safe (handles and names only),
 * leave no trace, and nothing here widens what a parent can see.
 */

const T1 = "2026-09-26T09:00:00Z";

/** Internal ids and references must never surface in safety context. */
const INTERNAL = /usr_|wal_|fam_|mem_|opr_|snd_|prq_|spc_|frd_|trf_|TRF-|apv_/;

function mustAssess<T>(result: SandboxResult<T>): string {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return JSON.stringify(result.value);
}

describe("Assessments are display-safe", () => {
  it("never leak account, wallet, family or operation ids", () => {
    const db = buildSeedDatabase();
    expect(mustAssess(assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1))).not.toMatch(INTERNAL);
    const asked = createMoneyRequestTransition(db, {
      actorId: SEED_PEER_ID,
      at: T1,
      payer: "@aarav",
      amount: 60,
      idempotencyKey: "prq_priv_01",
    }).db;
    expect(
      mustAssess(assessRequestSafety(asked, SEED_TEEN_ID, asked.peerRequests[0]!.requestId)),
    ).not.toMatch(INTERNAL);
    expect(mustAssess(assessRequestCreateSafety(db, SEED_TEEN_ID, "@meera"))).not.toMatch(INTERNAL);
  });

  it("never state balances, amounts or counts beyond the teen's own history", () => {
    const db = buildSeedDatabase();
    const large = mustAssess(assessSendSafety(db, SEED_TEEN_ID, "@meera", 1500, T1));
    expect(large).not.toMatch(/₹|\d{3,}/); // no balance figures in copy
    // Only the rapid-repeat reminder quotes the teen's own payment count.
    const send = mustAssess(assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1));
    expect(send).not.toMatch(/balance|wallet/i);
  });

  it("speaks about people by TeenPay ID and name only — no labels", () => {
    const text = mustAssess(assessSendSafety(buildSeedDatabase(), SEED_TEEN_ID, "@meera", 100, T1));
    expect(text).toContain("@meera");
    expect(text).not.toMatch(/scammer|stranger|unsafe|risky|suspect/i);
  });
});

describe("Assessments leave no trace", () => {
  it("assessing changes nothing — no history, no events, no settings", () => {
    const db = linkedDatabase();
    const before = JSON.stringify(db);
    assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1);
    assessRequestCreateSafety(db, SEED_TEEN_ID, "@meera");
    const asked = createMoneyRequestTransition(db, {
      actorId: SEED_PEER_ID,
      at: T1,
      payer: "@aarav",
      amount: 60,
      idempotencyKey: "prq_priv_02",
    }).db;
    assessRequestSafety(asked, SEED_TEEN_ID, asked.peerRequests[0]!.requestId);
    expect(JSON.stringify(db)).toBe(before);
    // The read paths don't even copy the database.
    expect(JSON.stringify(asked.securityEvents)).toBe(JSON.stringify(db.securityEvents));
    expect(db.shieldSettings).toBeUndefined();
  });

  it("the one write path stores reminders only — never a safety history", () => {
    const db = linkedDatabase();
    const out = updateShieldSettingsTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T1,
      patch: { repeatedPayments: false },
    });
    if (!out.result.ok) throw new Error(JSON.stringify(out.result));
    const record = out.db.shieldSettings![0]!;
    expect(Object.keys(record).sort()).toEqual([
      "firstTimeRecipient",
      "largePayments",
      "ownerAccountId",
      "repeatedPayments",
      "updatedAt",
    ]);
    // No reason codes, no assessments, no recipients — the owner id is
    // the record's key (as with friendships), not leaked context.
    const payload: Record<string, unknown> = { ...record };
    delete payload.ownerAccountId;
    expect(JSON.stringify(payload)).not.toMatch(INTERNAL);
    expect(JSON.stringify(payload)).not.toMatch(/first_payment|large_amount|rapid_repeat/);
    expect(out.db.securityEvents.length).toBe(db.securityEvents.length);
  });
});

describe("Parent privacy (§21) is unchanged", () => {
  it("parents are refused everywhere, and the refusal reveals nothing about the teen", () => {
    const db = linkedDatabase();
    const send = assessSendSafety(db, SEED_PARENT_ID, "@meera", 100, T1);
    expect(send).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    if (!send.ok) {
      expect(send.error.message).not.toContain("@meera");
      expect(send.error.message).not.toMatch(/aarav/i);
    }
    const save = updateShieldSettingsTransition(db, {
      actorId: SEED_PARENT_ID,
      at: T1,
      patch: { largePayments: false },
    });
    expect(save.result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(save.db).toBe(db); // nothing written
  });

  it("a teen's reminder choices stay their own — no guardian field, no reporting", () => {
    const out = updateShieldSettingsTransition(buildSeedDatabase(), {
      actorId: SEED_TEEN_ID,
      at: T1,
      patch: { firstTimeRecipient: false },
    });
    if (!out.result.ok) throw new Error(JSON.stringify(out.result));
    const record = JSON.stringify(out.db.shieldSettings);
    expect(record).not.toMatch(/guardian|parent|family|notified/i);
    expect(shieldSettingsFor(out.db, SEED_PEER_ID).firstTimeRecipient).toBe(true); // isolation
  });
});

describe("Tampering with stored reminders is rejected", () => {
  function stored(): SandboxDatabase {
    const out = updateShieldSettingsTransition(buildSeedDatabase(), {
      actorId: SEED_TEEN_ID,
      at: T1,
      patch: { largePayments: false },
    });
    if (!out.result.ok) throw new Error("setup");
    return out.db;
  }

  it("accepts a valid shieldSettings array and rejects tampered ones", () => {
    expect(isSandboxDatabase(JSON.parse(JSON.stringify(stored())))).toBe(true);

    const extraKey = JSON.parse(JSON.stringify(stored()));
    extraKey.shieldSettings[0].score = 0.9;
    expect(isSandboxDatabase(extraKey)).toBe(false);

    const nonBoolean = JSON.parse(JSON.stringify(stored()));
    nonBoolean.shieldSettings[0].largePayments = "off";
    expect(isSandboxDatabase(nonBoolean)).toBe(false);

    const duplicateOwner = JSON.parse(JSON.stringify(stored()));
    duplicateOwner.shieldSettings.push({ ...duplicateOwner.shieldSettings[0] });
    expect(isSandboxDatabase(duplicateOwner)).toBe(false);

    const parentOwner = JSON.parse(JSON.stringify(stored()));
    parentOwner.shieldSettings[0].ownerAccountId = SEED_PARENT_ID;
    expect(isSandboxDatabase(parentOwner)).toBe(false);

    const unknownOwner = JSON.parse(JSON.stringify(stored()));
    unknownOwner.shieldSettings[0].ownerAccountId = "usr_ghost";
    expect(isSandboxDatabase(unknownOwner)).toBe(false);

    const badDate = JSON.parse(JSON.stringify(stored()));
    badDate.shieldSettings[0].updatedAt = "yesterday";
    expect(isSandboxDatabase(badDate)).toBe(false);

    const notAnArray = JSON.parse(JSON.stringify(stored()));
    notAnArray.shieldSettings = {};
    expect(isSandboxDatabase(notAnArray)).toBe(false);
  });

  it("a database without shieldSettings still loads (defaults apply)", () => {
    const db = buildSeedDatabase();
    expect(db.shieldSettings).toBeUndefined();
    expect(isSandboxDatabase(JSON.parse(JSON.stringify(db)))).toBe(true);
  });
});
