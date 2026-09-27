import { describe, expect, it } from "vitest";
import {
  databaseFromState,
  isSandboxDatabase,
  migrateToCurrent,
  migrateV2,
  migrateV3,
  migrateV4,
  migrateV5,
  migrateV6,
  migrateV7,
} from "@/sandbox/persistence";
import {
  SANDBOX_BACKUP_KEY,
  SANDBOX_STORAGE_KEY,
  createLocalRepository,
  createMemoryRepository,
  describeLoadOutcome,
} from "@/sandbox/repository";
import { scopeFor } from "@/sandbox/scope";
import { buildSeedDatabase, buildSeedState, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { createInviteTransition, claimInviteTransition } from "@/sandbox/family-transitions";
import { payTransition } from "@/sandbox/transitions";
import type { SandboxState } from "@/sandbox/types";
import {
  AT,
  LEGACY_SEED_GOALS,
  PARENT,
  TEEN,
  TEEN_WALLET,
  legacySeedLedger,
  must,
  teenBalance,
  teenLedger,
  toLegacyEntries,
  withRules,
} from "./helpers/fixtures";

const NOW = "2026-09-26T08:00:00.000Z";

/**
 * Rebuilds the exact Phase 3 (schema v2) payload shape from a view:
 * top-level money, `session`, `familyEvents`, v2 family members
 * (`userId`, `joinedAt`) and embedded link invites.
 */
function toV2(state: SandboxState, currentUserId = SEED_TEEN_ID): Record<string, unknown> {
  const invites = state.family.invites;
  return {
    version: 2,
    users: state.users.map((u) => {
      const v2 = { ...u } as Record<string, unknown>;
      delete v2.identifier;
      delete v2.updatedAt;
      return v2;
    }),
    session: { currentUserId },
    family: {
      id: state.family.id,
      name: state.family.name,
      members: state.family.members
        .filter((m) => m.status === "active")
        .map((m) => ({
          userId: m.accountId,
          role: m.role,
          ...(m.relationship ? { relationship: m.relationship } : {}),
          joinedAt: m.createdAt,
        })),
      links: state.family.links.map((l) => {
        const invite = invites.find((i) => i.id === l.inviteId);
        return {
          teenId: l.teenId,
          status: l.status,
          guardianId: l.guardianId,
          invite: invite
            ? {
                code: invite.code,
                teenId: invite.teenId,
                createdAt: invite.createdAt,
                ...(invite.claimedBy ? { claimedBy: invite.claimedBy } : {}),
              }
            : null,
          ...(l.linkedAt ? { linkedAt: l.linkedAt } : {}),
          updatedAt: l.updatedAt,
        };
      }),
      controls: state.family.controls,
    },
    // Phase 5: v2 stored the teen's entries in the pre-wallet shape,
    // plus payment records carrying their approval link.
    ledger: toLegacyEntries(teenLedger(state)),
    payments: state.operations
      .filter((op) => op.type === "payment" && op.legs.some((l) => l.walletId === TEEN_WALLET))
      .map((op) => ({
        id: op.id,
        direction: "send",
        amount: op.amount,
        currency: "INR",
        recipientId: op.recipientId,
        status: "succeeded",
        ...(op.approvalId ? { approvalId: op.approvalId } : {}),
        createdAt: op.createdAt,
      })),
    requests: state.requests,
    approvals: state.approvals,
    notifications: state.notifications,
    familyEvents: state.familyEvents,
    recipients: state.recipients,
    goals: LEGACY_SEED_GOALS,
  };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe("migration — Phase 3 (v2) → Phase 4 (v3)", () => {
  it("keeps money, rules, approvals and notifications; accounts gain v3 fields", () => {
    const linked = must(
      payTransition(withRules({ daily: 500, threshold: 500 }), {
        ...TEEN,
        entryId: "pay_750",
        recipientId: "rec_riya",
        amount: 750,
      }),
    );
    const v2 = JSON.parse(JSON.stringify(toV2(linked, SEED_PARENT_ID)));
    const result = migrateToCurrent(v2, { seedView: buildSeedState, now: NOW });
    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") return;
    expect(result.from).toBe(2);
    const db = result.db;
    expect(isSandboxDatabase(db)).toBe(true);

    // Money: identical entries (now in the teen's wallet), same derived
    // balance, pending approval kept.
    expect(toLegacyEntries(teenLedger(db))).toEqual(toLegacyEntries(teenLedger(linked)));
    expect(teenBalance(db)).toBe(teenBalance(linked));
    expect(db.teenRecords[0]?.approvals.map((a) => a.status)).toEqual(["pending"]);
    // Family: link + controls unchanged, members became memberships.
    expect(db.families[0]?.links[0]?.status).toBe("linked");
    expect(db.families[0]?.controls).toEqual(linked.family.controls);
    expect(db.families[0]?.members.every((m) => m.status === "active")).toBe(true);
    // Accounts: identifier and updatedAt added; nothing secret.
    expect(db.accounts.find((a) => a.id === SEED_TEEN_ID)?.identifier).toBe("sandbox:aarav");
    expect(JSON.stringify(db)).not.toMatch(/password|token|secret/i);
    // Notifications carried over per recipient.
    expect(db.notifications).toEqual(linked.notifications);
    // The v2 session pointer is not carried into data.
    expect(JSON.stringify(db)).not.toMatch(/currentUserId/);
    // The parent's scope after migration still has the linked view.
    const parent = scopeFor(db, SEED_PARENT_ID)!;
    expect(parent.info.walletTeenId).toBe(SEED_TEEN_ID);
  });

  it("an in-flight invite (claimed) survives with a fresh expiry and a pending membership", () => {
    let s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    s = must(claimInviteTransition(s, { ...PARENT, code: "TEEN-4821" }));
    // Phase 9: v2 → v3 → v4 → v5 → v6 → v7 → v8.
    const db = migrateV7(migrateV6(migrateV5(migrateV4(migrateV3(migrateV2(JSON.parse(JSON.stringify(toV2(s))), NOW)), NOW), NOW)));
    expect(isSandboxDatabase(db)).toBe(true);
    const invite = db.families[0]!.invites[0]!;
    expect(invite).toMatchObject({ code: "TEEN-4821", status: "claimed", claimedBy: SEED_PARENT_ID });
    expect(Date.parse(invite.expiresAt)).toBeGreaterThan(Date.parse(NOW));
    expect(db.families[0]!.links[0]!.inviteId).toBe(invite.id);
    expect(
      db.families[0]!.members.find((m) => m.accountId === SEED_PARENT_ID)?.status,
    ).toBe("pending");
  });
});

describe("migration — Phase 2 (v1) → v3", () => {
  it("chains v1 → v3 with the money kept and the family unlinked", () => {
    const seed = buildSeedState();
    const v1 = {
      version: 1,
      ledger: [
        ...legacySeedLedger(),
        {
          id: "pay_old",
          type: "payment_sent",
          direction: "debit",
          amount: 100,
          currency: "INR",
          description: "Old",
          counterparty: { kind: "person", id: "rec_riya", name: "Riya Patel" },
          createdAt: "2026-09-25T10:00:00Z",
        },
      ],
      payments: [],
      requests: [],
      notifications: [{ id: "n1", kind: "money", title: "Payment sent", body: "x", read: false, createdAt: AT }],
      recipients: seed.recipients,
      goals: LEGACY_SEED_GOALS,
    };
    const result = migrateToCurrent(JSON.parse(JSON.stringify(v1)), { seedView: buildSeedState, now: NOW });
    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") return;
    expect(result.from).toBe(1);
    expect(teenBalance(result.db)).toBe(teenBalance(seed) - 100);
    expect(result.db.families[0]?.links[0]?.status).toBe("not_linked");
    expect(result.db.notifications[0]?.recipientId).toBe(SEED_TEEN_ID);
  });
});

describe("repository — load, save, refresh, reset", () => {
  it("fresh storage starts from the seed; a save round-trips exactly (refresh)", () => {
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    const first = repo.load(NOW);
    expect(first.outcome.kind).toBe("fresh");
    const changed = databaseFromState(
      must(payTransition(buildSeedState(), { ...TEEN, entryId: "pay_1", recipientId: "rec_riya", amount: 100 })),
    );
    expect(repo.save(changed)).toBe(true);
    const again = createLocalRepository(() => storage).load(NOW);
    expect(again.outcome.kind).toBe("loaded");
    expect(again.db).toEqual(changed);
  });

  it("v2 data is migrated on load, and the original is backed up first", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(toV2(withRules({ daily: 500 })));
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const { db, outcome } = createLocalRepository(() => storage).load(NOW);
    expect(outcome).toEqual({ kind: "migrated", from: 2 });
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    expect(db.families[0]?.controls[0]?.limits.dailyLimit).toBe(500);
    expect(describeLoadOutcome(outcome)).toMatch(/nothing was lost/i);
  });

  it("malformed data is never silently dropped: backed up, seed used, explained", () => {
    for (const bad of ["{not json", '{"ledger":"nope"}', '{"version":3,"accounts":[]}', '{"version":99}']) {
      const storage = memoryStorage();
      storage.setItem(SANDBOX_STORAGE_KEY, bad);
      const { db, outcome } = createLocalRepository(() => storage).load(NOW);
      expect(outcome.kind).toBe("recovered");
      expect(db).toEqual(buildSeedDatabase());
      expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(bad);
      expect(describeLoadOutcome(outcome)).toMatch(/kept as a backup/i);
    }
  });

  it("a corrupted ledger entry is rejected rather than loaded", () => {
    const db = buildSeedDatabase();
    const broken = {
      ...db,
      ledger: [{ ...db.ledger[0]!, amount: -5 }, ...db.ledger.slice(1)],
    };
    expect(isSandboxDatabase(JSON.parse(JSON.stringify(broken)))).toBe(false);
  });

  it("duplicate usernames are rejected", () => {
    const db = buildSeedDatabase();
    const dup = { ...db, accounts: [...db.accounts, { ...db.accounts[0]!, id: "usr_other" }] };
    expect(isSandboxDatabase(JSON.parse(JSON.stringify(dup)))).toBe(false);
  });

  it("reset clears data and backups and returns the deterministic seed", () => {
    const storage = memoryStorage();
    storage.setItem(SANDBOX_STORAGE_KEY, "x");
    storage.setItem(SANDBOX_BACKUP_KEY, "y");
    const seed = createLocalRepository(() => storage).reset();
    expect(seed).toEqual(buildSeedDatabase());
    expect(storage.getItem(SANDBOX_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBeNull();
  });

  it("unavailable storage falls back to memory with an explanation", () => {
    const { outcome } = createLocalRepository(() => null).load(NOW);
    expect(outcome.kind).toBe("unavailable");
    expect(describeLoadOutcome(outcome)).toMatch(/reset when you close the tab/i);
  });

  it("the memory repository behaves the same way", () => {
    const repo = createMemoryRepository();
    expect(repo.load().outcome.kind).toBe("fresh");
    const db = buildSeedDatabase();
    repo.save(db);
    expect(repo.load().db).toBe(db);
    expect(repo.reset()).toEqual(buildSeedDatabase());
  });

  it("the seed database is deterministic", () => {
    expect(JSON.stringify(buildSeedDatabase())).toBe(JSON.stringify(buildSeedDatabase()));
  });
});
