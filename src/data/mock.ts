/**
 * Static sandbox catalog — identities and reference data.
 *
 * Phase 2: financial state (balances, spaces, goals progress, activity,
 * notifications) is DERIVED from the sandbox ledger in `src/sandbox/`
 * and persisted to localStorage. This module holds only what never
 * changes at runtime: who the family is, who can be paid, and which
 * goals exist. Fictional/demo identities only.
 */

import type {
  GoalBlueprint,
  Household,
  Merchant,
  TeenProfile,
  TrustedRecipient,
} from "@/domain";

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
/* Pay destinations — parent-approved people + vetted places           */
/* ------------------------------------------------------------------ */

export const mockRecipients: TrustedRecipient[] = [
  {
    id: "rcp_meera",
    name: "Meera Sharma",
    handle: "@meera",
    kind: "parent",
    avatarSeed: "meera",
    relationship: "Mother",
    parentApproved: true,
  },
  {
    id: "rcp_diya",
    name: "Diya Patel",
    handle: "@diya",
    kind: "teen",
    avatarSeed: "diya",
    relationship: "Friend",
    parentApproved: true,
    lastAmountPaise: 15_000,
  },
  {
    id: "rcp_kabir",
    name: "Kabir Rao",
    handle: "@kabir",
    kind: "teen",
    avatarSeed: "kabir",
    relationship: "Cousin",
    parentApproved: true,
    lastAmountPaise: 20_000,
  },
  {
    id: "rcp_riya",
    name: "Riya Nair",
    handle: "@riya",
    kind: "teen",
    avatarSeed: "riya",
    relationship: "Friend",
    parentApproved: true,
  },
  {
    id: "rcp_ananya",
    name: "Ananya Iyer",
    handle: "@ananya",
    kind: "teen",
    avatarSeed: "ananya",
    relationship: "Friend",
    parentApproved: true,
  },
];

export const mockMerchants: Merchant[] = [
  { id: "m_crossword", name: "Crossword", category: "Books", avatarSeed: "crossword" },
  { id: "m_metro", name: "City Metro", category: "Travel", avatarSeed: "metro" },
  { id: "m_bluetokai", name: "Blue Tokai", category: "Café", avatarSeed: "bluetokai" },
];

/* ------------------------------------------------------------------ */
/* Goal blueprints — progress is derived from the ledger               */
/* ------------------------------------------------------------------ */

export const goalBlueprints: GoalBlueprint[] = [
  {
    id: "goal_buds",
    teenId: mockTeen.id,
    name: "Noise Buds Pro",
    tag: "Audio",
    targetPaise: 299_900,
    dueDate: new Date(Date.now() + 54 * DAY_MS).toISOString(),
    createdAt: atDaysAgo(21, 18, 5),
  },
  {
    id: "goal_cycle",
    teenId: mockTeen.id,
    name: "Weekend cycle fund",
    tag: "Long term",
    targetPaise: 800_000,
    createdAt: atDaysAgo(9, 11, 20),
  },
];
