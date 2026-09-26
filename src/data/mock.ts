/**
 * Controlled mock data for Phase 1.
 *
 * The UI renders ONLY from this module until a backend exists. Every
 * screen that shows these values also shows a discreet "Sample data"
 * indicator so mock figures are never mistaken for real money.
 */

import type {
  Household,
  Merchant,
  SavingsGoal,
  TeenProfile,
  TeenWallet,
  Transaction,
  TrustedRecipient,
} from "@/domain";
import { isMockMode } from "@/lib/env";

/** Phase 1 always renders mock data — explicit, never accidental. */
export const MOCK_DATA = true;
export const isSampleData = (): boolean => MOCK_DATA && isMockMode();

const DAY_MS = 86_400_000;
const atDaysAgo = (days: number, hour = 12, minute = 0): string => {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

/* ------------------------------------------------------------------ */
/* Family                                                              */
/* ------------------------------------------------------------------ */

export const mockTeen: TeenProfile = {
  id: "teen_aarav",
  kind: "teen",
  displayName: "Aarav Sharma",
  avatarSeed: "aarav",
  familyId: "fam_sharma",
  birthYear: 2011,
  guardianApproved: true,
  createdAt: atDaysAgo(210, 9, 30),
};

export const mockHousehold: Household = {
  family: {
    id: "fam_sharma",
    name: "Sharma family",
    teenIds: ["teen_aarav"],
    parentIds: ["parent_meera"],
    createdAt: atDaysAgo(210, 9, 30),
  },
  teens: [mockTeen],
  parents: [
    {
      id: "parent_meera",
      kind: "parent",
      displayName: "Meera Sharma",
      avatarSeed: "meera",
      familyId: "fam_sharma",
      relationship: "mother",
      guardianVerification: "verified",
      createdAt: atDaysAgo(210, 9, 31),
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Wallet — spend + save + goals MUST equal available (tested).        */
/* ------------------------------------------------------------------ */

export const mockWallet: TeenWallet = {
  teenId: mockTeen.id,
  currency: "INR",
  availablePaise: 245_000,
  spaces: {
    spend: {
      type: "spend",
      label: "Spend",
      description: "Everyday money — food, travel, fun.",
      balancePaise: 85_000,
      currency: "INR",
    },
    save: {
      type: "save",
      label: "Save",
      description: "Set aside. Out of sight, growing.",
      balancePaise: 120_000,
      currency: "INR",
    },
    goals: {
      type: "goals",
      label: "Goals",
      description: "Ring-fenced for things you're saving for.",
      balancePaise: 40_000,
      currency: "INR",
    },
  },
  /** Expected this month: allowance + birthday money on the way. */
  upcomingPaise: 50_000,
};

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

export const mockGoals: SavingsGoal[] = [
  {
    id: "goal_buds",
    teenId: mockTeen.id,
    name: "Noise Buds Pro",
    tag: "Audio",
    targetPaise: 299_900,
    savedPaise: 40_000,
    dueDate: new Date(Date.now() + 54 * DAY_MS).toISOString(),
    createdAt: atDaysAgo(21, 18, 5),
  },
  {
    id: "goal_cycle",
    teenId: mockTeen.id,
    name: "Weekend cycle fund",
    tag: "Long term",
    targetPaise: 800_000,
    savedPaise: 0,
    createdAt: atDaysAgo(9, 11, 20),
  },
];

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export const mockTransactions: Transaction[] = [
  {
    id: "tx_01",
    title: "Monthly pocket money",
    counterparty: { name: "Meera Sharma", kind: "parent" },
    amountPaise: 100_000,
    direction: "in",
    category: "family",
    status: "settled",
    occurredAt: atDaysAgo(0, 9, 5),
    note: "September allowance",
  },
  {
    id: "tx_02",
    title: "Crossword Bookstore",
    counterparty: { name: "Crossword", kind: "merchant" },
    amountPaise: 34_900,
    direction: "out",
    category: "education",
    status: "settled",
    occurredAt: atDaysAgo(1, 17, 42),
  },
  {
    id: "tx_03",
    title: "Metro card top-up",
    counterparty: { name: "City Metro", kind: "merchant" },
    amountPaise: 20_000,
    direction: "out",
    category: "transport",
    status: "settled",
    occurredAt: atDaysAgo(2, 8, 15),
  },
  {
    id: "tx_04",
    title: "Café with friends",
    counterparty: { name: "Blue Tokai", kind: "merchant" },
    amountPaise: 18_000,
    direction: "out",
    category: "food",
    status: "settled",
    occurredAt: atDaysAgo(3, 16, 20),
  },
  {
    id: "tx_05",
    title: "Birthday gift",
    counterparty: { name: "Rohan Sharma", kind: "parent" },
    amountPaise: 50_000,
    direction: "in",
    category: "family",
    status: "settled",
    occurredAt: atDaysAgo(5, 10, 0),
    note: "Happy birthday!",
  },
  {
    id: "tx_06",
    title: "Goal contribution",
    counterparty: { name: "Noise Buds Pro", kind: "system" },
    amountPaise: 40_000,
    direction: "out",
    category: "goals",
    status: "settled",
    occurredAt: atDaysAgo(6, 19, 30),
  },
  {
    id: "tx_07",
    title: "Split from Diya",
    counterparty: { name: "Diya", kind: "teen" },
    amountPaise: 15_000,
    direction: "in",
    category: "transfer",
    status: "pending",
    occurredAt: atDaysAgo(7, 14, 8),
    note: "Movie tickets",
  },
  {
    id: "tx_08",
    title: "Music subscription",
    counterparty: { name: "Melody+", kind: "merchant" },
    amountPaise: 9_900,
    direction: "out",
    category: "entertainment",
    status: "settled",
    occurredAt: atDaysAgo(9, 7, 55),
  },
];

/* ------------------------------------------------------------------ */
/* Pay destinations                                                    */
/* ------------------------------------------------------------------ */

export const mockRecipients: TrustedRecipient[] = [
  {
    id: "rcp_diya",
    name: "Diya Patel",
    avatarSeed: "diya",
    relationship: "Friend",
    parentApproved: true,
    lastAmountPaise: 15_000,
  },
  {
    id: "rcp_kabir",
    name: "Kabir Rao",
    avatarSeed: "kabir",
    relationship: "Cousin",
    parentApproved: true,
    lastAmountPaise: 20_000,
  },
  {
    id: "rcp_meera",
    name: "Meera Sharma",
    avatarSeed: "meera",
    relationship: "Mother",
    parentApproved: true,
  },
];

export const mockMerchants: Merchant[] = [
  { id: "m_crossword", name: "Crossword", category: "Books", avatarSeed: "crossword" },
  { id: "m_metro", name: "City Metro", category: "Travel", avatarSeed: "metro" },
  { id: "m_bluetokai", name: "Blue Tokai", category: "Café", avatarSeed: "bluetokai" },
];

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/** Newest-first. */
export function getTransactions(): Transaction[] {
  return [...mockTransactions].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
}

export function getRecentTransactions(count: number): Transaction[] {
  return getTransactions().slice(0, count);
}

export interface TransactionDayGroup {
  key: string;
  label: string;
  items: Transaction[];
}

/** Group newest-first transactions by calendar day (stable keys). */
export function groupTransactionsByDay(
  transactions: Transaction[],
  labelFor: (iso: string) => string,
): TransactionDayGroup[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const day = tx.occurredAt.slice(0, 10);
    const list = groups.get(day);
    if (list) list.push(tx);
    else groups.set(day, [tx]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: labelFor(items[0].occurredAt),
    items,
  }));
}

export function sumByDirection(
  transactions: Transaction[],
  direction: "in" | "out",
): number {
  return transactions
    .filter((t) => t.direction === direction && t.status !== "failed")
    .reduce((sum, t) => sum + t.amountPaise, 0);
}
