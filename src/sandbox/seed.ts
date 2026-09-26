/**
 * Deterministic sandbox seed — the opening ledger every fresh sandbox
 * starts from. Produces the familiar ₹2,450 across Spend ₹850 / Save
 * ₹1,200 / Goals ₹400, plus realistic history and one pending split.
 *
 * Timestamps derive from the provided `now` so tests can pin time and
 * the app seeds relative to first launch.
 */

import type {
  LedgerDirection,
  LedgerEntry,
  LedgerReason,
  LedgerSpace,
  TransactionCategory,
  TransactionCounterparty,
} from "@/domain";
import type { UserId } from "@/domain";
import { mockTeen } from "@/data/mock";
import { SANDBOX_VERSION, type SandboxState } from "./storage";

export const SANDBOX_WALLET_ID = "wallet_teen_aarav";

const DAY_MS = 86_400_000;

function daysAgo(now: Date, days: number, hour = 12, minute = 0): string {
  const d = new Date(now.getTime() - days * DAY_MS);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

interface SeedDraft {
  id: string;
  direction: LedgerDirection;
  amountPaise: number;
  reason: LedgerReason;
  space: LedgerSpace;
  title: string;
  counterparty: TransactionCounterparty;
  category: TransactionCategory;
  note?: string;
  postedAt: string;
  pending?: boolean;
  groupId?: string;
  counterEntryId?: string;
  metadata?: LedgerEntry["metadata"];
}

function buildSeedEntries(now: Date, walletId: string): LedgerEntry[] {
  const month = now.toLocaleDateString("en-IN", { month: "long" });
  const drafts: SeedDraft[] = [
    {
      id: "seed_01",
      direction: "credit",
      amountPaise: 107_800,
      reason: "adjustment",
      space: "spend",
      title: "Starting balance",
      counterparty: { name: "TeenPay", kind: "system" },
      category: "other",
      note: "Sandbox starting balance",
      postedAt: daysAgo(now, 210, 9, 30),
    },
    {
      id: "seed_02",
      direction: "credit",
      amountPaise: 70_000,
      reason: "adjustment",
      space: "save",
      title: "Starting balance",
      counterparty: { name: "TeenPay", kind: "system" },
      category: "other",
      note: "Sandbox starting balance",
      postedAt: daysAgo(now, 210, 9, 30),
    },
    {
      id: "seed_03",
      direction: "debit",
      amountPaise: 9_900,
      reason: "merchant_payment",
      space: "spend",
      title: "Music subscription",
      counterparty: { name: "Melody+", kind: "merchant" },
      category: "entertainment",
      postedAt: daysAgo(now, 9, 7, 55),
    },
    {
      id: "seed_04",
      direction: "credit",
      amountPaise: 15_000,
      reason: "peer_transfer",
      space: "spend",
      title: "Split from Diya",
      counterparty: { name: "Diya", kind: "teen" },
      category: "transfer",
      note: "Movie tickets",
      postedAt: daysAgo(now, 7, 14, 8),
      pending: true,
    },
    {
      id: "seed_05",
      direction: "debit",
      amountPaise: 40_000,
      reason: "goal_contribution",
      space: "spend",
      title: "Noise Buds Pro",
      counterparty: { name: "Noise Buds Pro", kind: "system" },
      category: "goals",
      postedAt: daysAgo(now, 6, 19, 30),
      groupId: "seed_grp_goal",
      counterEntryId: "seed_06",
      metadata: { goalId: "goal_buds", fromSpace: "spend", toSpace: "goals", leg: "debit" },
    },
    {
      id: "seed_06",
      direction: "credit",
      amountPaise: 40_000,
      reason: "goal_contribution",
      space: "goals",
      title: "Noise Buds Pro",
      counterparty: { name: "Noise Buds Pro", kind: "system" },
      category: "goals",
      postedAt: daysAgo(now, 6, 19, 30),
      groupId: "seed_grp_goal",
      counterEntryId: "seed_05",
      metadata: { goalId: "goal_buds", fromSpace: "spend", toSpace: "goals", leg: "credit" },
    },
    {
      id: "seed_07",
      direction: "credit",
      amountPaise: 50_000,
      reason: "top_up",
      space: "save",
      title: "Birthday gift",
      counterparty: { name: "Rohan Sharma", kind: "parent" },
      category: "family",
      note: "Happy birthday!",
      postedAt: daysAgo(now, 5, 10, 0),
    },
    {
      id: "seed_08",
      direction: "debit",
      amountPaise: 18_000,
      reason: "merchant_payment",
      space: "spend",
      title: "Café with friends",
      counterparty: { name: "Blue Tokai", kind: "merchant" },
      category: "food",
      postedAt: daysAgo(now, 3, 16, 20),
    },
    {
      id: "seed_09",
      direction: "debit",
      amountPaise: 20_000,
      reason: "merchant_payment",
      space: "spend",
      title: "Metro card top-up",
      counterparty: { name: "City Metro", kind: "merchant" },
      category: "transport",
      postedAt: daysAgo(now, 2, 8, 15),
    },
    {
      id: "seed_10",
      direction: "debit",
      amountPaise: 34_900,
      reason: "merchant_payment",
      space: "spend",
      title: "Crossword Bookstore",
      counterparty: { name: "Crossword", kind: "merchant" },
      category: "education",
      postedAt: daysAgo(now, 1, 17, 42),
    },
    {
      id: "seed_11",
      direction: "credit",
      amountPaise: 100_000,
      reason: "allowance",
      space: "spend",
      title: "Monthly pocket money",
      counterparty: { name: "Meera Sharma", kind: "parent" },
      category: "family",
      note: `${month} allowance`,
      postedAt: daysAgo(now, 0, 9, 5),
    },
  ];

  let running = 0;
  return drafts.map((draft) => {
    // Pending entries don't move the running balance.
    if (!draft.pending) {
      running += draft.direction === "credit" ? draft.amountPaise : -draft.amountPaise;
    }
    const entry: LedgerEntry = {
      id: draft.id,
      walletId,
      direction: draft.direction,
      amountPaise: draft.amountPaise,
      balanceAfterPaise: running,
      reason: draft.reason,
      space: draft.space,
      status: draft.pending ? "pending" : "posted",
      idempotencyKey: `seed:${draft.id}`,
      counterEntryId: draft.counterEntryId,
      groupId: draft.groupId,
      title: draft.title,
      counterparty: draft.counterparty,
      category: draft.category,
      note: draft.note,
      metadata: draft.metadata ?? {},
      postedAt: draft.postedAt,
    };
    return entry;
  });
}

/** Fresh sandbox state for `teenId` (defaults to the sandbox teen). */
export function createSeedState(now: Date, teenId: UserId = mockTeen.id): SandboxState {
  const seededAt = now.toISOString();
  return {
    version: SANDBOX_VERSION,
    walletId: SANDBOX_WALLET_ID,
    teenId,
    entries: buildSeedEntries(now, SANDBOX_WALLET_ID),
    requests: [],
    notifications: [
      {
        id: "seed_welcome",
        kind: "system",
        title: "Welcome to your sandbox",
        body: "Explore TeenPay with simulated money. Nothing here is real — reset anytime from Profile.",
        read: false,
        createdAt: seededAt,
        href: "/profile",
      },
    ],
    seededAt,
    updatedAt: seededAt,
  };
}
