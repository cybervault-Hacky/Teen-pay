import { describe, expect, it } from "vitest";
import { DEFAULT_SHIELD_SETTINGS, primaryWalletId, type ShieldAssessment } from "@/domain";
import { addContactTransition } from "@/sandbox/contacts";
import {
  acceptFriendRequestTransition,
  sendFriendRequestTransition,
} from "@/sandbox/friends";
import { changeTeenPayIdTransition } from "@/sandbox/teenpay-id";
import {
  createMoneyRequestTransition,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import {
  assessRequestCreateSafety,
  assessRequestSafety,
  assessSendSafety,
  shieldSettingsFor,
  updateShieldSettingsTransition,
} from "@/sandbox/shield";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase, SandboxResult } from "@/sandbox/types";
import { linkedDatabase } from "./helpers/fixtures";
import { buildSeedDatabase } from "@/sandbox/seed";

/**
 * Shield engine (Phase 14): deterministic safety context derived from
 * sandbox data alone. Read paths return the input database untouched;
 * the one write path stores only the teen's own optional reminders.
 */

const T1 = "2026-09-26T09:00:00Z";
const T2 = "2026-09-26T14:00:00Z";

const codes = (r: { value: ShieldAssessment }) => r.value.reasons.map((x) => x.code);

function must<T>(out: SandboxResult<T>): asserts out is { ok: true; value: T } {
  if (!out.ok) throw new Error(JSON.stringify(out));
}

interface DbOutput {
  db: SandboxDatabase;
  result: { ok: boolean };
}

function mustDb(out: DbOutput): SandboxDatabase {
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return out.db;
}

/** Aarav sent ₹100 to Meera at `at`. */
function paid(db: SandboxDatabase, at: string, key: string, amount = 100): SandboxDatabase {
  return mustDb(
    sendMoneyTransition(db, { actorId: SEED_TEEN_ID, at, recipient: "@meera", amount, idempotencyKey: key }),
  );
}

/** Aarav and Meera are accepted friends. */
function friends(db: SandboxDatabase): SandboxDatabase {
  const sent = sendFriendRequestTransition(db, {
    actorId: SEED_TEEN_ID,
    at: T1,
    teenPayId: "@meera",
    requestId: "frd_shd_0001",
  });
  const friendshipId = sent.db.friendships![0]!.friendshipId;
  return mustDb(
    acceptFriendRequestTransition(sent.db, { actorId: SEED_PEER_ID, at: T1, friendshipId }),
  );
}

describe("Send safety — first-time recipients", () => {
  it("the first ever payment asks for one calm confirmation", () => {
    const db = buildSeedDatabase();
    const result = assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1);
    must(result);
    expect(result.value.outcome).toBe("confirm");
    expect(codes(result)).toContain("first_payment");
    expect(codes(result)).toContain("not_in_circle");
  });

  it("after one payment the first-time and circle context disappear", () => {
    const db = paid(buildSeedDatabase(), T1, "snd_shd_k1");
    const result = assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T2);
    must(result);
    expect(result.value.outcome).toBe("allow");
    expect(result.value.reasons).toEqual([]);
  });

  it("a favourite is known — no circle notice, but a first payment still pauses", () => {
    let db = buildSeedDatabase();
    db = mustDb(
      addContactTransition(db, { actorId: SEED_TEEN_ID, at: T1, teenPayId: "@meera", contactId: "ctc_shd_01" }),
    );
    const first = assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1);
    must(first);
    expect(codes(first)).toEqual(["first_payment"]);
    expect(first.value.outcome).toBe("confirm");

    const after = assessSendSafety(paid(db, T1, "snd_shd_k2"), SEED_TEEN_ID, "@meera", 100, T2);
    must(after);
    expect(after.value.outcome).toBe("allow");
  });

  it("a friend is known — no circle notice, favourites never bypass anything else", () => {
    const db = friends(buildSeedDatabase());
    const result = assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1);
    must(result);
    expect(codes(result)).toEqual(["first_payment"]);
  });
});

describe("Send safety — large amounts", () => {
  it("half or more of the money available to send asks for a review", () => {
    // One ₹50 payment first: known recipient, ₹1,800 left to send.
    // ₹900 × 2 ≥ 1,800 → large.
    const db = paid(buildSeedDatabase(), T1, "snd_shd_k3", 50);
    const at = assessSendSafety(db, SEED_TEEN_ID, "@meera", 900, T2);
    must(at);
    expect(codes(at)).toEqual(["large_amount"]);
    expect(at.value.outcome).toBe("confirm");
  });

  it("below the share nothing is added", () => {
    const db = paid(buildSeedDatabase(), T1, "snd_shd_k4", 50); // ₹1,800 left
    const below = assessSendSafety(db, SEED_TEEN_ID, "@meera", 899, T2);
    must(below);
    expect(below.value.outcome).toBe("allow");
  });

  it("zero amounts add no large-amount reason", () => {
    const db = paid(buildSeedDatabase(), T1, "snd_shd_k5", 50);
    const zero = assessSendSafety(db, SEED_TEEN_ID, "@meera", 0, T2);
    must(zero);
    expect(zero.value.reasons.filter((r) => r.code === "large_amount")).toEqual([]);
  });
});

describe("Send safety — repeated payments", () => {
  it("the third payment to one person inside 24 hours asks for a review", () => {
    let db = buildSeedDatabase();
    db = paid(db, T1, "snd_shd_r1");
    db = paid(db, T2, "snd_shd_r2");
    const result = assessSendSafety(db, SEED_TEEN_ID, "@meera", 50, "2026-09-26T15:00:00Z");
    must(result);
    expect(codes(result)).toContain("rapid_repeat");
    expect(result.value.outcome).toBe("confirm");
  });

  it("two payments only produce context, not a pause", () => {
    const db = paid(buildSeedDatabase(), T1, "snd_shd_r3");
    const result = assessSendSafety(db, SEED_TEEN_ID, "@meera", 50, T2);
    must(result);
    expect(codes(result)).not.toContain("rapid_repeat");
  });

  it("payments older than the 24-hour window don't count", () => {
    let db = buildSeedDatabase();
    db = paid(db, "2026-09-25T06:00:00Z", "snd_shd_r4");
    db = paid(db, "2026-09-25T07:00:00Z", "snd_shd_r5");
    const result = assessSendSafety(db, SEED_TEEN_ID, "@meera", 50, "2026-09-26T07:00:01Z");
    must(result);
    expect(codes(result)).not.toContain("rapid_repeat");
  });

  it("the window boundary is deterministic — exactly 24 hours ago still counts", () => {
    let db = buildSeedDatabase();
    db = paid(db, "2026-09-25T09:00:00Z", "snd_shd_r6");
    db = paid(db, "2026-09-25T09:00:01Z", "snd_shd_r7");
    const result = assessSendSafety(db, SEED_TEEN_ID, "@meera", 50, "2026-09-26T09:00:00Z");
    must(result);
    expect(codes(result)).toContain("rapid_repeat");
  });
});

describe("Send safety — resolution and refusals", () => {
  it("yourself is always fine", () => {
    const result = assessSendSafety(buildSeedDatabase(), SEED_TEEN_ID, "@aarav", 100, T1);
    must(result);
    expect(result.value.outcome).toBe("allow");
  });

  it("unknown recipients and malformed IDs get the directory's own refusal shape", () => {
    expect(assessSendSafety(buildSeedDatabase(), SEED_TEEN_ID, "@nobody", 100, T1)).toMatchObject({
      ok: false,
      error: { code: "unknown_recipient" },
    });
    // Internal ids are never a way to find someone.
    expect(assessSendSafety(buildSeedDatabase(), SEED_TEEN_ID, "usr_meera", 100, T1)).toMatchObject({
      ok: false,
      error: { code: "unknown_recipient" },
    });
  });

  it("ineligible accounts (parents) never confirm they exist", () => {
    expect(assessSendSafety(buildSeedDatabase(), SEED_TEEN_ID, "@priya", 100, T1)).toMatchObject({
      ok: false,
      error: { code: "unknown_recipient" },
    });
  });

  it("parents are gated — shield.use is a teen permission", () => {
    expect(assessSendSafety(buildSeedDatabase(), SEED_PARENT_ID, "@meera", 100, T1)).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    });
  });
});

describe("Request safety — incoming requests", () => {
  /** Meera asks Aarav for ₹60 at `at`. */
  function asked(db: SandboxDatabase, at: string, key: string): SandboxDatabase {
    return mustDb(
      createMoneyRequestTransition(db, { actorId: SEED_PEER_ID, at, payer: "@aarav", amount: 60, idempotencyKey: key }),
    );
  }
  // New requests are prepended — index 0 is always the newest.
  const requestIdOf = (db: SandboxDatabase) => db.peerRequests[0]!.requestId;

  it("a first request from a stranger gets a calm notice — nothing else changes", () => {
    const db = asked(buildSeedDatabase(), T1, "prq_shd_01");
    const result = assessRequestSafety(db, SEED_TEEN_ID, requestIdOf(db));
    must(result);
    expect(result.value.outcome).toBe("notice");
    expect(codes(result)).toEqual(["unknown_requester"]);
    // Nothing moved, nothing changed.
    expect(db.peerRequests[0]!.status).toBe("pending");
  });

  it("friends, past payments and past requests each suppress the unknown notice", () => {
    const friendDb = asked(friends(buildSeedDatabase()), T1, "prq_shd_02");
    const byFriend = assessRequestSafety(
      friendDb,
      SEED_TEEN_ID,
      requestIdOf(friendDb),
    );
    must(byFriend);
    expect(byFriend.value.outcome).toBe("allow");

    const historyDb = asked(paid(buildSeedDatabase(), T1, "snd_shd_h1"), T2, "prq_shd_03");
    const byHistory = assessRequestSafety(historyDb, SEED_TEEN_ID, requestIdOf(historyDb));
    must(byHistory);
    expect(byHistory.value.outcome).toBe("allow");
  });

  it("a prior request in either direction means you're not strangers", () => {
    let db = buildSeedDatabase();
    db = mustDb(
      createMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: T1, payer: "@meera", amount: 30, idempotencyKey: "prq_shd_04" }),
    );
    db = asked(db, T2, "prq_shd_05"); // Meera asks Aarav this time
    const result = assessRequestSafety(db, SEED_TEEN_ID, requestIdOf(db));
    must(result);
    expect(result.value.outcome).toBe("allow");
  });

  it("a renamed requester is explained, never re-labelled", () => {
    let db = asked(buildSeedDatabase(), T1, "prq_shd_06");
    const id = requestIdOf(db);
    db = mustDb(changeTeenPayIdTransition(db, { actorId: SEED_PEER_ID, at: T2, teenPayId: "@meera_k" }));
    const result = assessRequestSafety(db, SEED_TEEN_ID, id);
    must(result);
    expect(codes(result)).toContain("requester_identity_updated");
    const reason = result.value.reasons.find((r) => r.code === "requester_identity_updated")!;
    expect(reason.title).toBe("@meera_k used to be @meera");
    expect(reason.explanation).toContain("same account");
    // The historical snapshot is intact — no history rewritten.
    expect(db.peerRequests.find((r) => r.requestId === id)!.requesterHandle).toBe("@meera");
  });

  it("requests that aren't yours or don't exist are refused plainly", () => {
    const db = asked(buildSeedDatabase(), T1, "prq_shd_07");
    expect(assessRequestSafety(db, SEED_TEEN_ID, "prq_missing")).toMatchObject({
      ok: false,
      error: { code: "unknown_request" },
    });
    // Meera is the requester, not the payer.
    expect(assessRequestSafety(db, SEED_PEER_ID, requestIdOf(db))).toMatchObject({
      ok: false,
      error: { code: "unknown_request" },
    });
  });

  it("parents cannot read request safety context either", () => {
    const db = asked(buildSeedDatabase(), T1, "prq_shd_08");
    expect(assessRequestSafety(db, SEED_PARENT_ID, requestIdOf(db))).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    });
  });
});

describe("Request-create safety — asking someone", () => {
  it("a quiet notice when nothing connects you yet", () => {
    const result = assessRequestCreateSafety(buildSeedDatabase(), SEED_TEEN_ID, "@meera");
    must(result);
    expect(result.value.outcome).toBe("notice");
    expect(codes(result)).toEqual(["not_in_circle"]);
  });

  it("friends and past interactions stay quiet", () => {
    const friendly = assessRequestCreateSafety(friends(buildSeedDatabase()), SEED_TEEN_ID, "@meera");
    must(friendly);
    expect(friendly.value.outcome).toBe("allow");
    const after = assessRequestCreateSafety(
      paid(buildSeedDatabase(), T1, "snd_shd_c1"),
      SEED_TEEN_ID,
      "@meera",
    );
    must(after);
    expect(after.value.outcome).toBe("allow");
  });
});

describe("Shield reads are pure", () => {
  it("assessments return the very same database object — nothing is written", () => {
    const db = buildSeedDatabase();
    const before = JSON.stringify(db);
    assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1);
    assessRequestCreateSafety(db, SEED_TEEN_ID, "@meera");
    const askedDb = mustDb(
      createMoneyRequestTransition(db, { actorId: SEED_PEER_ID, at: T1, payer: "@aarav", amount: 60, idempotencyKey: "prq_shd_p1" }),
    );
    assessRequestSafety(askedDb, SEED_TEEN_ID, askedDb.peerRequests[0]!.requestId);
    expect(JSON.stringify(db)).toBe(before);
    expect(assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1)).toEqual(
      assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1),
    );
  });
});

describe("Optional reminders — the one write path", () => {
  it("defaults apply before anything is stored", () => {
    expect(shieldSettingsFor(buildSeedDatabase(), SEED_TEEN_ID)).toEqual(DEFAULT_SHIELD_SETTINGS);
  });

  it("stores only the actor's own reminders and nothing else", () => {
    const db = buildSeedDatabase();
    const before = { ...db, shieldSettings: undefined };
    const out = updateShieldSettingsTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T1,
      patch: { largePayments: false },
    });
    if (!out.result.ok) throw new Error(JSON.stringify(out.result));
    expect(out.result.value.settings).toEqual({ firstTimeRecipient: true, largePayments: false, repeatedPayments: true });
    const { shieldSettings, ...rest } = out.db;
    expect(rest).toEqual(before);
    expect(shieldSettings).toHaveLength(1);
    expect(shieldSettingsFor(out.db, SEED_TEEN_ID).largePayments).toBe(false);
    // Meera's defaults are untouched.
    expect(shieldSettingsFor(out.db, SEED_PEER_ID)).toEqual(DEFAULT_SHIELD_SETTINGS);
  });

  it("patches merge and re-saving keeps one record per owner", () => {
    let db = buildSeedDatabase();
    db = updateShieldSettingsTransition(db, { actorId: SEED_TEEN_ID, at: T1, patch: { largePayments: false } }).db;
    const out = updateShieldSettingsTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T2,
      patch: { repeatedPayments: false },
    });
    if (!out.result.ok) throw new Error(JSON.stringify(out.result));
    expect(out.result.value.settings).toEqual({ firstTimeRecipient: true, largePayments: false, repeatedPayments: false });
    expect(out.db.shieldSettings).toHaveLength(1);
    expect(out.db.shieldSettings![0]!.updatedAt).toBe(T2);
  });

  it("timestamps never go backwards", () => {
    let db = buildSeedDatabase();
    db = updateShieldSettingsTransition(db, { actorId: SEED_TEEN_ID, at: T2, patch: { largePayments: false } }).db;
    const out = updateShieldSettingsTransition(db, { actorId: SEED_TEEN_ID, at: T1, patch: { largePayments: true } });
    expect(out.db.shieldSettings![0]!.updatedAt).toBe(T2);
  });

  it("refuses non-boolean patches and writes nothing", () => {
    const db = buildSeedDatabase();
    const out = updateShieldSettingsTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T1,
      patch: { largePayments: "off" as unknown as boolean },
    });
    expect(out.result.ok).toBe(false);
    expect(out.db).toBe(db);
  });

  it("parents cannot store reminders — teen-only like the reads", () => {
    const out = updateShieldSettingsTransition(buildSeedDatabase(), {
      actorId: SEED_PARENT_ID,
      at: T1,
      patch: { largePayments: false },
    });
    expect(out.result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });

  it("a switched-off reminder softens its confirmation into an inline notice", () => {
    let db = buildSeedDatabase();
    db = updateShieldSettingsTransition(db, { actorId: SEED_TEEN_ID, at: T1, patch: { firstTimeRecipient: false } }).db;
    const result = assessSendSafety(db, SEED_TEEN_ID, "@meera", 100, T1);
    must(result);
    expect(result.value.outcome).toBe("notice");
    expect(result.value.reasons.map((r) => `${r.code}:${r.level}`)).toEqual([
      "first_payment:notice",
      "not_in_circle:notice",
    ]);
  });
});

describe("Shield context never replaces the payment engine", () => {
  it("assessments don't change what sendMoneyTransition decides", () => {
    const db = linkedDatabase({ daily: 200, perTx: null, threshold: null });
    // The shield asks for a pause…
    const safety = assessSendSafety(db, SEED_TEEN_ID, "@meera", 250, T1);
    must(safety);
    expect(safety.value.outcome).toBe("confirm");
    // …and the daily limit still refuses on its own terms.
    const send = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T1,
      recipient: "@meera",
      amount: 250,
      idempotencyKey: "snd_shd_lim1",
    });
    expect(send.result.ok).toBe(false);
    if (!send.result.ok) expect(send.result.error.code).toBe("exceeds_daily_limit");
  });

  it("a frozen wallet is still frozen no matter what the shield says", () => {
    let db = buildSeedDatabase();
    db = {
      ...db,
      wallets: db.wallets.map((w) =>
        w.id === primaryWalletId(SEED_TEEN_ID) ? { ...w, status: "frozen" as const } : w,
      ),
    };
    const safety = assessSendSafety(db, SEED_TEEN_ID, "@meera", 50, T1);
    must(safety);
    expect(safety.value.outcome).toBe("confirm"); // the pause changes nothing below
    const send = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T1,
      recipient: "@meera",
      amount: 50,
      idempotencyKey: "snd_shd_frz1",
    });
    expect(send.result.ok).toBe(false);
  });
});
