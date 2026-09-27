import {
  checkDisplayName,
  checkUsername,
  defaultSaveSpaceId,
  initialsFor,
  normalizeInviteCode,
  primaryWalletId,
  SANDBOX_CURRENCY,
  type Family,
  type NewAccountInput,
  type SecurityEvent,
  type SecurityEventType,
  type User,
  type UsernameCheck,
  type Wallet,
} from "@/domain";
import { depositDraft, postOperation } from "./operations";
import { appendSecurityEvents, findAccount } from "./scope";
import { PARENT_STARTING_FUNDS, type SandboxDatabase, type SandboxError } from "./types";

/**
 * Account-level operations on the sandbox database: the directory,
 * username availability, account creation, deletion requests and
 * security events. These are the pieces a cloud repository would
 * implement server-side; the rules themselves live in the domain.
 */

/** Is this (normalized) username already used by any account? */
export function isUsernameTaken(db: SandboxDatabase, username: string): boolean {
  return db.accounts.some((a) => a.username === username);
}

/** Validation + uniqueness, as shown in the create-account form. */
export function checkUsernameAvailability(db: SandboxDatabase, raw: string): UsernameCheck {
  return checkUsername(raw, (normalized) => isUsernameTaken(db, normalized));
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function uniqueId(prefix: string, base: string, taken: (id: string) => boolean): string {
  let id = `${prefix}_${base}`;
  let n = 2;
  while (taken(id)) {
    id = `${prefix}_${base}_${n}`;
    n += 1;
  }
  return id;
}

export interface CreateAccountResult {
  db: SandboxDatabase;
  account: User;
}

/**
 * Creates a sandbox account. Collects a name, a TeenPay ID and a
 * role — nothing else (no phone, DOB, ID documents or credentials).
 *
 * Every account gets its own primary wallet (owned by the account,
 * never shared). A new teen also gets their own family (as its only
 * active member, with no guardian yet) and starts at ₹0. A new
 * parent's wallet starts with sandbox funds so pocket money has a
 * source; they join a family by entering a teen's invite code.
 */
export function createAccount(
  db: SandboxDatabase,
  input: NewAccountInput,
  now: string,
): CreateAccountResult | SandboxError {
  if (input.role !== "teen" && input.role !== "parent") {
    return { code: "invalid_account", message: "Choose whether this is a teen or parent account." };
  }
  const name = checkDisplayName(input.displayName);
  if (name.message) return { code: "invalid_account", message: name.message };
  const username = checkUsernameAvailability(db, input.username);
  if (username.problem === "taken") {
    return { code: "username_taken", message: username.message ?? "That ID is taken." };
  }
  if (username.problem) {
    return { code: "invalid_account", message: username.message ?? "That ID isn't valid." };
  }

  const accountId = uniqueId("usr", slug(username.username), (id) =>
    db.accounts.some((a) => a.id === id),
  );
  const fullName = name.displayName;
  const account: User = {
    id: accountId,
    role: input.role,
    identifier: `sandbox:${username.username}`,
    name: fullName,
    displayName: fullName.split(" ")[0] ?? fullName,
    username: username.username,
    avatarInitials: initialsFor(fullName),
    status: "active",
    identitySource: "sandbox",
    createdAt: now,
    updatedAt: now,
  };

  const wallet: Wallet = {
    id: primaryWalletId(accountId),
    ownerAccountId: accountId,
    kind: "primary",
    currency: SANDBOX_CURRENCY,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  let next: SandboxDatabase = {
    ...db,
    accounts: [...db.accounts, account],
    wallets: [...db.wallets, wallet],
    // Every teen starts with the default Save Space (empty).
    spaces:
      input.role === "teen"
        ? [
            ...db.spaces,
            {
              id: defaultSaveSpaceId(accountId),
              ownerAccountId: accountId,
              walletId: wallet.id,
              name: "Save",
              type: "save",
              icon: "piggy-bank",
              status: "active",
              displayOrder: 0,
              isDefault: true,
              createdAt: now,
              updatedAt: now,
            },
          ]
        : db.spaces,
  };

  if (input.role === "parent") {
    const funded = postOperation(
      next,
      depositDraft({
        id: `dep_start_${accountId}`,
        actorId: accountId,
        at: now,
        walletId: wallet.id,
        amount: PARENT_STARTING_FUNDS,
      }),
    );
    if (!funded.ok) return funded.error;
    next = funded.journal;
  }

  if (input.role === "teen") {
    const familyId = uniqueId("fam", slug(username.username), (id) =>
      db.families.some((f) => f.id === id),
    );
    const family: Family = {
      id: familyId,
      name: `${account.displayName}'s family`,
      members: [
        {
          id: `mem_${familyId}_${accountId}`,
          familyId,
          accountId,
          role: "teen",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      links: [
        { teenId: accountId, status: "not_linked", guardianId: null, inviteId: null, updatedAt: now },
      ],
      controls: [],
      invites: [],
      createdAt: now,
    };
    next = {
      ...next,
      families: [...next.families, family],
      teenRecords: [
        ...next.teenRecords,
        { teenId: accountId, requests: [], approvals: [] },
      ],
      familyLogs: [...next.familyLogs, { familyId, events: [] }],
    };
  }

  next = recordSecurityEvent(next, accountId, "account_created", now);
  return { db: next, account };
}

/**
 * Records that the account holder asked for deletion. This is a
 * placeholder for a real, reviewed deletion process: nothing is
 * deleted, and financial history is never removed by it.
 */
export function requestAccountDeletion(
  db: SandboxDatabase,
  accountId: string,
  now: string,
): SandboxDatabase | SandboxError {
  const account = findAccount(db, accountId);
  if (!account) return { code: "unknown_user", message: "Account not found." };
  if (account.deletionRequestedAt) return db;
  const next: SandboxDatabase = {
    ...db,
    accounts: db.accounts.map((a) =>
      a.id === accountId ? { ...a, deletionRequestedAt: now, updatedAt: now } : a,
    ),
  };
  return recordSecurityEvent(next, accountId, "account_deletion_requested", now);
}

export function cancelAccountDeletion(
  db: SandboxDatabase,
  accountId: string,
  now: string,
): SandboxDatabase {
  const account = findAccount(db, accountId);
  if (!account?.deletionRequestedAt) return db;
  const next: SandboxDatabase = {
    ...db,
    accounts: db.accounts.map((a) => {
      if (a.id !== accountId) return a;
      const rest = { ...a, updatedAt: now };
      delete rest.deletionRequestedAt;
      return rest;
    }),
  };
  return recordSecurityEvent(next, accountId, "account_deletion_cancelled", now);
}

export function recordSecurityEvent(
  db: SandboxDatabase,
  accountId: string,
  type: SecurityEventType,
  at: string,
  sessionId?: string,
): SandboxDatabase {
  const event: SecurityEvent = {
    id: `sec_${type}_${accountId}_${sessionId ?? ""}_${at}`,
    type,
    accountId,
    at,
    ...(sessionId ? { sessionId } : {}),
  };
  return appendSecurityEvents(db, [event]);
}

export function securityEventsFor(db: SandboxDatabase, accountId: string): SecurityEvent[] {
  return db.securityEvents.filter((e) => e.accountId === accountId);
}

/** The family holding an open or claimed invite with this code. */
export function familyIdForInviteCode(db: SandboxDatabase, raw: string): string | null {
  const code = normalizeInviteCode(raw);
  const family = db.families.find((f) =>
    f.invites.some((i) => i.code === code && (i.status === "open" || i.status === "claimed")),
  );
  return family?.id ?? null;
}

/** All invite codes in use (so new ones never collide). */
export function inviteCodesInUse(db: SandboxDatabase): Set<string> {
  return new Set(db.families.flatMap((f) => f.invites.map((i) => i.code)));
}

/**
 * The account "Switch role" moves to — the transparent sandbox demo
 * control. It prefers the people this account is actually connected
 * with, then falls back to the first active account with that role.
 */
export function sandboxSwitchTarget(
  db: SandboxDatabase,
  viewerId: string,
  role: User["role"],
): User | null {
  const viewer = findAccount(db, viewerId);
  if (viewer?.role === role && viewer.status === "active") return viewer;
  const active = (id: string | null | undefined) => {
    const account = id ? findAccount(db, id) : null;
    return account && account.status === "active" && account.role === role ? account : null;
  };
  for (const family of db.families) {
    for (const link of family.links) {
      if (role === "parent" && link.teenId === viewerId) {
        const invite = family.invites.find((i) => i.id === link.inviteId);
        const connected =
          (link.status === "linked" ? active(link.guardianId) : null) ??
          active(invite?.claimedBy);
        if (connected) return connected;
      }
      if (role === "teen") {
        const invite = family.invites.find((i) => i.id === link.inviteId);
        if (
          (link.status === "linked" && link.guardianId === viewerId) ||
          invite?.claimedBy === viewerId
        ) {
          const teen = active(link.teenId);
          if (teen) return teen;
        }
      }
    }
  }
  return db.accounts.find((a) => a.role === role && a.status === "active") ?? null;
}
