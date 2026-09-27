import {
  defaultSaveSpaceId,
  primaryWalletId,
  SANDBOX_CURRENCY,
  type AppNotification,
  type Family,
  type MoneyRequest,
  type MoneySpace,
  type Recipient,
  type User,
  type Wallet,
} from "@/domain";
import {
  depositDraft,
  paymentDraft,
  postOperation,
  spaceMoveDraft,
  transferDraft,
  type Journal,
  type OperationDraft,
} from "./operations";
import { databaseView } from "./scope";
import {
  PARENT_STARTING_FUNDS,
  SANDBOX_SCHEMA_VERSION,
  type SandboxDatabase,
  type SandboxState,
} from "./types";

/**
 * The sandbox's initial state — deterministic by design.
 *
 * Timestamps are fixed (stored in UTC, rendered in Asia/Kolkata)
 * so server-rendered and client-rendered output always agree.
 * All identities are fictional sandbox identities; nothing here is
 * real and nothing is verified.
 *
 * Accounts: three fictional sandbox accounts — Aarav (teen) and Priya
 * (parent) in the Sharma family, and Meera (teen, @meera) in her own
 * family, so TeenPay-to-TeenPay sending and requesting can be tried
 * straight away. Nobody is signed in initially — that's the auth
 * layer's job, and it starts signed out.
 *
 * Family: the teen starts with no guardian connected, so the
 * linking journey (invite → review → connect) begins from a clean
 * state. Financial history is separate from the family
 * relationship, so earlier pocket money from Priya stays in the
 * ledger either way.
 *
 * Derived from this seed (Aarav's wallet):
 *   available balance  ₹1,850
 *   Save               ₹800 of an optional ₹2,000 target (40%)
 *   New Bike (goal)    ₹1,500 of ₹2,500 (60%), target date 2026-11-30
 *   allocated          ₹2,300 (Save + New Bike)
 *   Upcoming           ₹200 (one pending request)
 *   total              ₹4,150 (available + allocated)
 *
 * Meera's wallet: ₹1,200 of sandbox starting funds, all available
 * (an empty default Save Space). No money has moved between the two
 * teens, and there are no TeenPay money requests yet.
 */

export const SEED_TEEN_ID = "usr_aarav";
export const SEED_PARENT_ID = "usr_priya";
export const SEED_FAMILY_ID = "fam_sharma";
export const SEED_PEER_ID = "usr_meera";
export const SEED_PEER_FAMILY_ID = "fam_kapoor";
export const SEED_PEER_STARTING_FUNDS = 1200;
const SEED_CREATED_AT = "2026-09-01T04:30:00Z";

const teen: User = {
  id: SEED_TEEN_ID,
  role: "teen",
  name: "Aarav Sharma",
  displayName: "Aarav",
  username: "aarav",
  avatarInitials: "AS",
  status: "active",
  identitySource: "sandbox",
  identifier: "sandbox:aarav",
  createdAt: SEED_CREATED_AT,
  updatedAt: SEED_CREATED_AT,
};

const parent: User = {
  id: SEED_PARENT_ID,
  role: "parent",
  name: "Priya Sharma",
  displayName: "Priya",
  username: "priya",
  avatarInitials: "PS",
  status: "active",
  identitySource: "sandbox",
  identifier: "sandbox:priya",
  createdAt: SEED_CREATED_AT,
  updatedAt: SEED_CREATED_AT,
};

const peer: User = {
  id: SEED_PEER_ID,
  role: "teen",
  name: "Meera Kapoor",
  displayName: "Meera",
  username: "meera",
  avatarInitials: "MK",
  status: "active",
  identitySource: "sandbox",
  identifier: "sandbox:meera",
  createdAt: SEED_CREATED_AT,
  updatedAt: SEED_CREATED_AT,
};

/** Meera's own family: just her, no guardian connected. */
function seedPeerFamily(): Family {
  return {
    id: SEED_PEER_FAMILY_ID,
    name: "Meera's family",
    members: [
      {
        id: `mem_${SEED_PEER_FAMILY_ID}_${SEED_PEER_ID}`,
        familyId: SEED_PEER_FAMILY_ID,
        accountId: SEED_PEER_ID,
        role: "teen",
        status: "active",
        createdAt: SEED_CREATED_AT,
        updatedAt: SEED_CREATED_AT,
      },
    ],
    links: [
      {
        teenId: SEED_PEER_ID,
        status: "not_linked",
        guardianId: null,
        inviteId: null,
        updatedAt: SEED_CREATED_AT,
      },
    ],
    controls: [],
    invites: [],
    createdAt: SEED_CREATED_AT,
  };
}

function seedFamily(): Family {
  return {
    id: SEED_FAMILY_ID,
    name: "Sharma family",
    members: [
      {
        id: "mem_sharma_aarav",
        familyId: SEED_FAMILY_ID,
        accountId: SEED_TEEN_ID,
        role: "teen",
        status: "active",
        createdAt: SEED_CREATED_AT,
        updatedAt: SEED_CREATED_AT,
      },
    ],
    links: [
      {
        teenId: SEED_TEEN_ID,
        status: "not_linked",
        guardianId: null,
        inviteId: null,
        updatedAt: SEED_CREATED_AT,
      },
    ],
    controls: [],
    invites: [],
    createdAt: SEED_CREATED_AT,
  };
}

const recipients: Recipient[] = [
  {
    id: "rec_riya",
    name: "Riya Patel",
    type: "person",
    handle: "@riya",
    descriptor: "Close friend",
  },
  {
    id: "rec_kabir",
    name: "Kabir Mehta",
    type: "person",
    handle: "@kabir",
    descriptor: "Classmate",
  },
  {
    id: "rec_ananya",
    name: "Ananya Iyer",
    type: "person",
    handle: "@ananya",
    descriptor: "Movie buddy",
  },
  {
    id: "rec_diya",
    name: "Diya Nair",
    type: "person",
    handle: "@diya",
    descriptor: "Neighbor",
  },
];

/** Aarav's Money Spaces: the default Save and one goal. */
export const SEED_SAVE_SPACE_ID = defaultSaveSpaceId(SEED_TEEN_ID);
export const SEED_GOAL_SPACE_ID = "goal_bike";

function seedSpaces(): MoneySpace[] {
  const base = {
    ownerAccountId: SEED_TEEN_ID,
    walletId: primaryWalletId(SEED_TEEN_ID),
    status: "active" as const,
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  };
  return [
    {
      ...base,
      id: SEED_SAVE_SPACE_ID,
      name: "Save",
      type: "save",
      icon: "piggy-bank",
      targetAmount: 2000,
      displayOrder: 0,
      isDefault: true,
    },
    {
      ...base,
      id: SEED_GOAL_SPACE_ID,
      name: "New Bike",
      type: "goal",
      icon: "bike",
      targetAmount: 2500,
      deadline: "2026-11-30",
      displayOrder: 1,
    },
    // Meera's default Save Space (empty), as every teen gets.
    {
      id: defaultSaveSpaceId(SEED_PEER_ID),
      ownerAccountId: SEED_PEER_ID,
      walletId: primaryWalletId(SEED_PEER_ID),
      name: "Save",
      type: "save",
      icon: "piggy-bank",
      status: "active",
      displayOrder: 0,
      isDefault: true,
      createdAt: SEED_CREATED_AT,
      updatedAt: SEED_CREATED_AT,
    },
  ];
}

/**
 * Seed money, as operations. Built through the same `postOperation`
 * path the app uses, so the seed can never contain an entry the
 * engine would reject. All timestamps are UTC.
 *
 * Priya's wallet starts with ₹10,000 of sandbox funds; each pocket
 * money payment is a two-sided transfer from her wallet to Aarav's.
 *   Priya  10,000 − 2,500 − 1,500 − 500           = ₹5,500
 *   Aarav  2,500 − 1,500 + 1,500 − 800 − 350 + 500 = ₹1,850
 */
const TEEN_WALLET = primaryWalletId(SEED_TEEN_ID);
const PARENT_WALLET = primaryWalletId(SEED_PARENT_ID);
const PEER_WALLET = primaryWalletId(SEED_PEER_ID);
const AARAV = { walletId: TEEN_WALLET, accountId: SEED_TEEN_ID, name: "Aarav" };
const PRIYA = { walletId: PARENT_WALLET, accountId: SEED_PARENT_ID, name: "Priya" };

function seedWallet(ownerAccountId: string): Wallet {
  return {
    id: primaryWalletId(ownerAccountId),
    ownerAccountId,
    kind: "primary",
    currency: SANDBOX_CURRENCY,
    status: "active",
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  };
}

function seedDrafts(): OperationDraft[] {
  const [save, bike] = seedSpaces() as [MoneySpace, MoneySpace];
  return [
    depositDraft({ id: "seed_dep_priya", actorId: SEED_PARENT_ID, at: SEED_CREATED_AT, walletId: PARENT_WALLET, amount: PARENT_STARTING_FUNDS }),
    depositDraft({ id: "seed_dep_meera", actorId: SEED_PEER_ID, at: SEED_CREATED_AT, walletId: PEER_WALLET, amount: SEED_PEER_STARTING_FUNDS }),
    transferDraft({ id: "seed_allow_1", actorId: SEED_PARENT_ID, at: "2026-09-08T03:30:00Z", from: PRIYA, to: AARAV, amount: 2500, purpose: "allowance" }),
    spaceMoveDraft({ id: "seed_goal_1", actorId: SEED_TEEN_ID, at: "2026-09-08T03:35:00Z", walletId: TEEN_WALLET, amount: 1500, space: bike, direction: "add" }),
    transferDraft({ id: "seed_allow_2", actorId: SEED_PARENT_ID, at: "2026-09-17T14:00:00Z", from: PRIYA, to: AARAV, amount: 1500, purpose: "allowance" }),
    spaceMoveDraft({ id: "seed_save_1", actorId: SEED_TEEN_ID, at: "2026-09-18T12:30:00Z", walletId: TEEN_WALLET, amount: 800, space: save, direction: "add" }),
    paymentDraft({ id: "seed_pay_1", actorId: SEED_TEEN_ID, at: "2026-09-24T12:42:00Z", walletId: TEEN_WALLET, amount: 350, note: "Movie night", recipient: { id: "rec_ananya", name: "Ananya Iyer" } }),
    transferDraft({ id: "seed_allow_3", actorId: SEED_PARENT_ID, at: "2026-09-25T03:30:00Z", from: PRIYA, to: AARAV, amount: 500, purpose: "allowance" }),
  ];
}

function seedJournal(): Journal {
  let journal: Journal = {
    wallets: [seedWallet(SEED_TEEN_ID), seedWallet(SEED_PARENT_ID), seedWallet(SEED_PEER_ID)],
    ledger: [],
    operations: [],
    spaces: seedSpaces(),
  };
  for (const draft of seedDrafts()) {
    const result = postOperation(journal, draft);
    if (!result.ok) throw new Error(`Invalid seed operation ${draft.id}: ${result.error.message}`);
    journal = result.journal;
  }
  return journal;
}

const seedRequests: MoneyRequest[] = [
  {
    id: "seed_req_1",
    amount: 200,
    currency: "INR",
    recipientId: "rec_kabir",
    note: "Café split",
    status: "pending",
    createdAt: "2026-09-24T14:45:00Z",
  },
];

const seedNotifications: AppNotification[] = [
  {
    id: "seed_ntf_1",
    recipientId: SEED_TEEN_ID,
    kind: "money",
    title: "Pocket money received",
    body: "₹500 from Priya is in Aarav's wallet.",
    read: false,
    createdAt: "2026-09-25T03:30:00Z",
  },
  {
    id: "seed_ntf_2",
    recipientId: SEED_TEEN_ID,
    kind: "money",
    title: "Request sent",
    body: "You requested ₹200 from Kabir Mehta · Café split.",
    read: true,
    createdAt: "2026-09-24T14:45:00Z",
  },
  {
    id: "seed_ntf_3",
    recipientId: SEED_TEEN_ID,
    kind: "money",
    title: "Payment sent",
    body: "₹350 to Ananya Iyer · Movie night.",
    read: true,
    createdAt: "2026-09-24T12:42:00Z",
  },
  {
    id: "seed_ntf_4",
    recipientId: SEED_TEEN_ID,
    kind: "goal",
    title: "Goal update",
    body: "New Bike is 60% of the way there.",
    read: true,
    createdAt: "2026-09-18T12:30:00Z",
  },
];

/** The deterministic initial database. */
export function buildSeedDatabase(): SandboxDatabase {
  const journal = seedJournal();
  return {
    version: SANDBOX_SCHEMA_VERSION,
    accounts: [{ ...teen }, { ...parent }, { ...peer }],
    families: [seedFamily(), seedPeerFamily()],
    wallets: journal.wallets,
    ledger: journal.ledger,
    operations: journal.operations,
    spaces: journal.spaces,
    // The seed family starts unlinked, so there's no pocket money
    // schedule yet — one needs a linked parent.
    pocketMoneySchedules: [],
    teenRecords: [
      {
        teenId: SEED_TEEN_ID,
        requests: seedRequests.map((request) => ({ ...request })),
        approvals: [],
      },
      { teenId: SEED_PEER_ID, requests: [], approvals: [] },
    ],
    peerRequests: [],
    notifications: seedNotifications.map((notification) => ({ ...notification })),
    familyLogs: [
      { familyId: SEED_FAMILY_ID, events: [] },
      { familyId: SEED_PEER_FAMILY_ID, events: [] },
    ],
    securityEvents: [],
    recipients: recipients.map((recipient) => ({ ...recipient })),
  };
}

/**
 * The seed family as one engine-level view, viewed by the teen and
 * including every seed account. Used by pure engine tests; the app
 * itself always works on per-account scopes (see `scope.ts`).
 */
export function buildSeedState(): SandboxState {
  return databaseView(buildSeedDatabase(), SEED_FAMILY_ID, SEED_TEEN_ID);
}
