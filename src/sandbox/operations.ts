import {
  REFERENCE_PREFIX,
  SANDBOX_CURRENCY,
  walletMutationProblem,
  type LedgerCounterparty,
  type LedgerDirection,
  type LedgerEntry,
  type LedgerEntryType,
  type MoneyOperation,
  type MoneyOperationType,
  type MoneySpace,
  type OperationLeg,
  type Recipient,
  type Wallet,
} from "@/domain";
import {
  amountError,
  appendEntry,
  isSpaceEntry,
  spaceBalance,
  validateEntry,
  walletEntries,
} from "./engine";
import { formatINR } from "@/lib/currency";
import type { SandboxError } from "./types";

/**
 * Money operations — the one write path for sandbox money.
 *
 *   draft ──▶ postOperation ──▶ { ledger entries + operation record }
 *
 * `postOperation` is atomic, idempotent and auditable:
 *  · Atomic — every leg is validated first (money, currency, wallet
 *    exists and is active, entry rules, no wallet goes below ₹0,
 *    compensation limits). Either all entries and the operation
 *    record are written, or nothing is.
 *  · Idempotent — the operation id is the idempotency key. Replaying
 *    the same operation returns the original and changes nothing;
 *    reusing an id for a different operation is rejected.
 *  · Auditable — the operation records who, what, when, which
 *    wallets, how much, and a unique human-facing reference.
 *  · Balanced — debits equal credits across the legs (double-entry
 *    style). Legs outside the sandbox (a fictional recipient, sandbox
 *    funding) are recorded on the operation, not as wallet entries.
 *
 * Payments, pocket money, transfers, refunds, reversals, deposits,
 * Money Space moves and request settlements are all drafts posted
 * here. There is no other way to write a ledger entry.
 *
 * Money Spaces: a Space leg (space_allocation / space_release) must
 * name a Space that exists, is active, and is bound to the same wallet
 * (and so the same owner); a release can't take more than the Space
 * holds. The available balance can't go below ₹0 either (the entry
 * rules), so neither side can ever be overdrawn.
 */

/** The financial records an operation reads and writes. */
export interface Journal {
  wallets: Wallet[];
  ledger: LedgerEntry[];
  operations: MoneyOperation[];
  /** Space settings, for validating Space legs (never balances). */
  spaces: MoneySpace[];
}

export interface WalletLegDraft {
  walletId: string;
  entryType: LedgerEntryType;
  direction: LedgerDirection;
  amount: number;
  counterparty: LedgerCounterparty;
  description: string;
  /** Required on space_allocation / space_release legs, only there. */
  spaceId?: string;
  requestId?: string;
  relatedEntryId?: string;
}

export interface ExternalLegDraft {
  external: LedgerCounterparty;
  direction: LedgerDirection;
  amount: number;
}

export type LegDraft = WalletLegDraft | ExternalLegDraft;

export interface OperationDraft {
  /** Idempotency key. Generate once per user intent. */
  id: string;
  type: MoneyOperationType;
  actorId: string;
  at: string;
  description: string;
  /** Defaults to INR (the only supported currency). */
  currency?: string;
  legs: LegDraft[];
  recipientId?: string;
  approvalId?: string;
  requestId?: string;
  relatedOperationId?: string;
  /** Scheduled pocket money only (see `allowanceRunDraft`). */
  scheduleId?: string;
  scheduledFor?: string;
}

export type PostResult<J extends Journal> =
  | { ok: true; journal: J; operation: MoneyOperation; replayed: boolean }
  | { ok: false; error: SandboxError };

function isWalletLeg(leg: LegDraft): leg is WalletLegDraft {
  return "walletId" in leg;
}

const DUPLICATE: SandboxError = {
  code: "duplicate",
  message: "This action was already recorded with different details. Nothing was changed.",
};

export function walletMutationError(wallet: Wallet): SandboxError | null {
  switch (walletMutationProblem(wallet)) {
    case "wallet_frozen":
      return {
        code: "wallet_frozen",
        message:
          "This wallet is frozen, so no money can move. Balance and history are still available.",
      };
    case "wallet_closed":
      return { code: "wallet_closed", message: "This wallet is closed, so no money can move." };
    default:
      return null;
  }
}

// ── References ────────────────────────────────────────────────────

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function base32(value: number, length: number): string {
  let out = "";
  let n = value >>> 0;
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[n % 32];
    n = Math.floor(n / 32);
  }
  return out;
}

/**
 * A stable, human-facing reference ("PAY-7K2M9QXA"), derived from the
 * operation id so replays always produce the same one, and made
 * unique against references already in use.
 */
export function referenceFor(
  type: MoneyOperationType,
  operationId: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const body =
    base32(fnv1a(operationId, 0x811c9dc5), 4) + base32(fnv1a(operationId, 0x01000193), 4);
  const base = `${REFERENCE_PREFIX[type]}-${body}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ── Compensation (refunds and reversals) ──────────────────────────

/** Rupees already refunded or reversed against an entry. */
export function compensatedAmount(ledger: readonly LedgerEntry[], entryId: string): number {
  return ledger
    .filter(
      (e) => e.relatedEntryId === entryId && (e.type === "refund" || e.type === "reversal"),
    )
    .reduce((sum, e) => sum + e.amount, 0);
}

/** How much of a payment can still be refunded. */
export function refundableAmount(ledger: readonly LedgerEntry[], entry: LedgerEntry): number {
  if (entry.type !== "payment_sent") return 0;
  return Math.max(0, entry.amount - compensatedAmount(ledger, entry.id));
}

function compensationError(
  ledger: readonly LedgerEntry[],
  leg: WalletLegDraft,
): SandboxError | null {
  if (leg.entryType !== "refund" && leg.entryType !== "reversal") {
    return leg.relatedEntryId
      ? { code: "entry_rejected", message: "Only refunds and reversals can point at another entry." }
      : null;
  }
  const original = ledger.find((e) => e.id === leg.relatedEntryId);
  if (!original || original.walletId !== leg.walletId) {
    return { code: "not_refundable", message: "The original transaction couldn't be found." };
  }
  if (original.type === "refund" || original.type === "reversal") {
    return { code: "not_refundable", message: "A correction can't itself be refunded or reversed." };
  }
  if (isSpaceEntry(original)) {
    return {
      code: "not_refundable",
      message: "Money Space moves are undone by moving the money back.",
    };
  }
  const already = compensatedAmount(ledger, original.id);
  if (leg.entryType === "refund") {
    if (original.type !== "payment_sent") {
      return { code: "not_refundable", message: "Only payments can be refunded." };
    }
    if (leg.amount > original.amount - already) {
      return {
        code: "not_refundable",
        message:
          already >= original.amount
            ? "This payment has already been fully refunded."
            : "A refund can't be more than what's left of the payment.",
      };
    }
    return null;
  }
  // Reversal: the exact opposite of an untouched original.
  if (already > 0) {
    return { code: "not_refundable", message: "This transaction was already corrected." };
  }
  if (leg.amount !== original.amount || leg.direction === original.direction) {
    return { code: "entry_rejected", message: "A reversal must exactly undo the original." };
  }
  return null;
}

// ── Money Space legs ──────────────────────────────────────────────

function spaceLegError(
  journal: Journal,
  ledger: readonly LedgerEntry[],
  leg: WalletLegDraft,
  wallet: Wallet,
): SandboxError | null {
  if (!isSpaceEntry({ type: leg.entryType })) {
    return leg.spaceId
      ? { code: "entry_rejected", message: "Only Money Space moves can name a Space." }
      : null;
  }
  const space = leg.spaceId ? journal.spaces.find((s) => s.id === leg.spaceId) : undefined;
  if (!space) {
    return { code: "unknown_space", message: "This Money Space isn't available." };
  }
  if (space.walletId !== wallet.id || space.ownerAccountId !== wallet.ownerAccountId) {
    return { code: "not_permitted", message: "This Money Space belongs to another wallet." };
  }
  if (space.status !== "active") {
    return {
      code: "space_archived",
      message: `${space.name} is archived, so money can't move in or out of it.`,
    };
  }
  if (leg.counterparty.kind !== "space" || leg.counterparty.id !== space.id) {
    return { code: "entry_rejected", message: "This move has the wrong counterparty." };
  }
  if (leg.entryType === "space_release") {
    const held = spaceBalance(ledger, space.id);
    if (leg.amount > held) {
      return {
        code: "insufficient_space_balance",
        message: `${space.name} has ${formatINR(held)}, so you can move back up to that. Nothing was moved.`,
      };
    }
  }
  return null;
}

// ── Posting ───────────────────────────────────────────────────────

/**
 * What makes two operations "the same" for idempotency: the type and
 * every leg's side, amount and party (wallet, or external party id —
 * e.g. the Space for a Space move).
 */
function fingerprint(
  type: MoneyOperationType,
  legs: {
    walletId?: string;
    external?: LedgerCounterparty;
    direction: LedgerDirection;
    amount: number;
  }[],
  schedule?: { scheduleId?: string; scheduledFor?: string },
): string {
  return [
    type,
    ...legs
      .map((l) => `${l.walletId ?? `ext:${l.external?.id ?? ""}`}:${l.direction}:${l.amount}`)
      .sort(),
    // Only scheduled pocket money carries this, so every other
    // operation's fingerprint is exactly what it always was.
    ...(schedule?.scheduleId ? [`schedule:${schedule.scheduleId}:${schedule.scheduledFor ?? ""}`] : []),
  ].join("|");
}

/**
 * Posts an operation. Returns the new journal, or an error with the
 * journal untouched. See the module comment for the guarantees.
 */
export function postOperation<J extends Journal>(
  journal: J,
  draft: OperationDraft,
): PostResult<J> {
  // Idempotency first: a replay is answered from the record.
  const existing = journal.operations.find((op) => op.id === draft.id);
  if (existing) {
    return fingerprint(existing.type, existing.legs, existing) === fingerprint(draft.type, draft.legs, draft)
      ? { ok: true, journal, operation: existing, replayed: true }
      : { ok: false, error: DUPLICATE };
  }

  const currency = draft.currency ?? SANDBOX_CURRENCY;
  const walletLegs = draft.legs.filter(isWalletLeg);
  if ((draft.scheduleId !== undefined || draft.scheduledFor !== undefined) && (
    draft.type !== "allowance" ||
    !draft.scheduleId ||
    !draft.scheduledFor ||
    draft.id !== `${draft.scheduleId}:${draft.scheduledFor}` ||
    walletLegs.length !== 2
  )) {
    return { ok: false, error: { code: "entry_rejected", message: "Only a scheduled pocket-money transfer can name a schedule." } };
  }
  if (walletLegs.length === 0 || walletLegs.length > 2) {
    return { ok: false, error: { code: "entry_rejected", message: "This operation has no valid wallet movement." } };
  }
  for (const leg of draft.legs) {
    const problem = amountError(leg.amount, currency);
    if (problem) return { ok: false, error: problem };
  }
  const debits = draft.legs.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
  const credits = draft.legs.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
  if (debits !== credits) {
    return { ok: false, error: { code: "entry_rejected", message: "This operation doesn't balance." } };
  }
  if (walletLegs.length === 2 && walletLegs[0]!.direction === walletLegs[1]!.direction) {
    return { ok: false, error: { code: "entry_rejected", message: "A transfer needs a sender and a receiver." } };
  }

  const reference = referenceFor(
    draft.type,
    draft.id,
    new Set(journal.operations.map((op) => op.reference)),
  );
  const entryIdFor = (leg: WalletLegDraft) =>
    walletLegs.length === 1 ? draft.id : `${draft.id}-${leg.direction === "debit" ? "dr" : "cr"}`;

  // Debits are checked against the balance before anything is added.
  const ordered = [...walletLegs].sort((a, b) =>
    a.direction === b.direction ? 0 : a.direction === "debit" ? -1 : 1,
  );
  let ledger = journal.ledger;
  const entries: LedgerEntry[] = [];
  for (const leg of ordered) {
    const wallet = journal.wallets.find((w) => w.id === leg.walletId);
    if (!wallet) {
      return { ok: false, error: { code: "unknown_wallet", message: "This wallet isn't available." } };
    }
    const blocked = walletMutationError(wallet);
    if (blocked) return { ok: false, error: blocked };
    if (wallet.currency !== currency) return { ok: false, error: amountError(1, currency)! };
    const compensation = compensationError(journal.ledger, leg);
    if (compensation) return { ok: false, error: compensation };
    const spaceProblem = spaceLegError(journal, ledger, leg, wallet);
    if (spaceProblem) return { ok: false, error: spaceProblem };

    const entry: LedgerEntry = {
      id: entryIdFor(leg),
      walletId: wallet.id,
      accountId: wallet.ownerAccountId,
      operationId: draft.id,
      reference,
      type: leg.entryType,
      direction: leg.direction,
      amount: leg.amount,
      currency: wallet.currency,
      status: "completed",
      description: leg.description,
      counterparty: leg.counterparty,
      ...(leg.spaceId ? { spaceId: leg.spaceId } : {}),
      ...(leg.requestId ? { requestId: leg.requestId } : {}),
      ...(draft.approvalId ? { approvalId: draft.approvalId } : {}),
      ...(leg.relatedEntryId ? { relatedEntryId: leg.relatedEntryId } : {}),
      ...(draft.scheduleId ? { scheduleId: draft.scheduleId, scheduledFor: draft.scheduledFor } : {}),
      createdAt: draft.at,
      createdBy: draft.actorId,
    };
    if (ledger.some((e) => e.id === entry.id)) return { ok: false, error: DUPLICATE };
    const invalid = validateEntry(entry, ledger);
    if (invalid) return { ok: false, error: invalid };
    ledger = appendEntry(ledger, entry);
    entries.push(entry);
  }

  const legs: OperationLeg[] = draft.legs.map((leg) =>
    isWalletLeg(leg)
      ? {
          direction: leg.direction,
          amount: leg.amount,
          walletId: leg.walletId,
          entryId: entryIdFor(leg),
        }
      : { direction: leg.direction, amount: leg.amount, external: leg.external },
  );
  const operation: MoneyOperation = Object.freeze({
    id: draft.id,
    reference,
    type: draft.type,
    status: "completed",
    actorId: draft.actorId,
    amount: debits,
    currency: SANDBOX_CURRENCY,
    legs,
    createdAt: draft.at,
    description: draft.description,
    ...(draft.recipientId ? { recipientId: draft.recipientId } : {}),
    ...(draft.approvalId ? { approvalId: draft.approvalId } : {}),
    ...(draft.requestId ? { requestId: draft.requestId } : {}),
    ...(draft.relatedOperationId ? { relatedOperationId: draft.relatedOperationId } : {}),
    ...(draft.scheduleId ? { scheduleId: draft.scheduleId, scheduledFor: draft.scheduledFor } : {}),
  }) as MoneyOperation;

  return {
    ok: true,
    journal: { ...journal, ledger, operations: [...journal.operations, operation] },
    operation,
    replayed: false,
  };
}

// ── Wallet lookups ────────────────────────────────────────────────

export function findWallet(wallets: readonly Wallet[], walletId: string): Wallet | null {
  return wallets.find((w) => w.id === walletId) ?? null;
}

/** Every wallet an account owns (multi-wallet ready). */
export function walletsOwnedBy(wallets: readonly Wallet[], accountId: string): Wallet[] {
  return wallets.filter((w) => w.ownerAccountId === accountId);
}

/** The account's primary wallet, if visible. */
export function primaryWalletOf(wallets: readonly Wallet[], accountId: string): Wallet | null {
  return wallets.find((w) => w.ownerAccountId === accountId && w.kind === "primary") ?? null;
}

// ── Drafts ────────────────────────────────────────────────────────

interface Base {
  id: string;
  actorId: string;
  at: string;
}

const SANDBOX_FUNDS: LedgerCounterparty = {
  kind: "sandbox",
  id: "sandbox_funds",
  name: "Sandbox funds",
};

/** Sandbox funding into a wallet — explicitly not real money. */
export function depositDraft(
  input: Base & { walletId: string; amount: number; description?: string },
): OperationDraft {
  const description = input.description ?? "Sandbox starting funds";
  return {
    id: input.id,
    type: "deposit",
    actorId: input.actorId,
    at: input.at,
    description,
    legs: [
      { external: SANDBOX_FUNDS, direction: "debit", amount: input.amount },
      {
        walletId: input.walletId,
        entryType: "deposit",
        direction: "credit",
        amount: input.amount,
        counterparty: SANDBOX_FUNDS,
        description,
      },
    ],
  };
}

/** A payment from a wallet to a fictional recipient. */
export function paymentDraft(
  input: Base & {
    walletId: string;
    recipient: Pick<Recipient, "id" | "name">;
    amount: number;
    note?: string;
    approvalId?: string;
  },
): OperationDraft {
  const counterparty: LedgerCounterparty = {
    kind: "person",
    id: input.recipient.id,
    name: input.recipient.name,
  };
  const description = input.note ?? "Sandbox payment";
  return {
    id: input.id,
    type: "payment",
    actorId: input.actorId,
    at: input.at,
    description,
    recipientId: input.recipient.id,
    approvalId: input.approvalId,
    legs: [
      {
        walletId: input.walletId,
        entryType: "payment_sent",
        direction: "debit",
        amount: input.amount,
        counterparty,
        description,
      },
      { external: counterparty, direction: "credit", amount: input.amount },
    ],
  };
}

interface WalletParty {
  walletId: string;
  accountId: string;
  name: string;
}

/**
 * Wallet-to-wallet movement: one debit and one credit in a single
 * atomic operation. `purpose: "allowance"` is pocket money from a
 * guardian's wallet to a teen's wallet.
 */
export function transferDraft(
  input: Base & {
    from: WalletParty;
    to: WalletParty;
    amount: number;
    note?: string;
    purpose?: "transfer" | "allowance";
  },
): OperationDraft {
  const allowance = input.purpose === "allowance";
  const description = input.note ?? (allowance ? "Pocket money" : "Transfer");
  return {
    id: input.id,
    type: allowance ? "allowance" : "transfer",
    actorId: input.actorId,
    at: input.at,
    description,
    legs: [
      {
        walletId: input.from.walletId,
        entryType: allowance ? "allowance_debit" : "transfer_out",
        direction: "debit",
        amount: input.amount,
        counterparty: { kind: "account", id: input.to.accountId, name: input.to.name },
        description,
      },
      {
        walletId: input.to.walletId,
        entryType: allowance ? "allowance_credit" : "transfer_in",
        direction: "credit",
        amount: input.amount,
        counterparty: allowance
          ? { kind: "guardian", id: input.from.accountId, name: input.from.name }
          : { kind: "account", id: input.from.accountId, name: input.from.name },
        description,
      },
    ],
  };
}

/**
 * One scheduled pocket-money occurrence: the same two-leg `allowance`
 * transfer as one-off pocket money (ALW- reference), tagged with its
 * schedule and occurrence. Its id is the execution id
 * `scheduleId:YYYY-MM-DD`, so an occurrence can only ever post once.
 */
export function allowanceRunDraft(
  input: Omit<Base, "id"> & {
    scheduleId: string;
    occurrence: string;
    from: WalletParty;
    to: WalletParty;
    amount: number;
  },
): OperationDraft {
  return {
    ...transferDraft({
      id: `${input.scheduleId}:${input.occurrence}`,
      actorId: input.actorId,
      at: input.at,
      from: input.from,
      to: input.to,
      amount: input.amount,
      note: "Scheduled pocket money",
      purpose: "allowance",
    }),
    scheduleId: input.scheduleId,
    scheduledFor: input.occurrence,
  };
}

/** Money returned against an earlier payment (a compensating credit). */
export function refundDraft(
  input: Base & { original: LedgerEntry; amount: number },
): OperationDraft {
  const description = `Refund from ${input.original.counterparty.name}`;
  return {
    id: input.id,
    type: "refund",
    actorId: input.actorId,
    at: input.at,
    description,
    relatedOperationId: input.original.operationId,
    recipientId: input.original.counterparty.id,
    legs: [
      { external: input.original.counterparty, direction: "debit", amount: input.amount },
      {
        walletId: input.original.walletId,
        entryType: "refund",
        direction: "credit",
        amount: input.amount,
        counterparty: input.original.counterparty,
        description,
        relatedEntryId: input.original.id,
      },
    ],
  };
}

/** A correction that exactly undoes an entry. The original stays. */
export function reversalDraft(
  input: Base & { original: LedgerEntry; reason: string },
): OperationDraft {
  const direction: LedgerDirection = input.original.direction === "credit" ? "debit" : "credit";
  return {
    id: input.id,
    type: "reversal",
    actorId: input.actorId,
    at: input.at,
    description: input.reason,
    relatedOperationId: input.original.operationId,
    legs: [
      {
        walletId: input.original.walletId,
        entryType: "reversal",
        direction,
        amount: input.original.amount,
        counterparty: input.original.counterparty,
        description: input.reason,
        relatedEntryId: input.original.id,
      },
      {
        external: { kind: "sandbox", id: "sandbox_correction", name: "Sandbox correction" },
        direction: input.original.direction,
        amount: input.original.amount,
      },
    ],
  };
}

/**
 * Moves money between a wallet's available balance and one of its
 * Money Spaces. `add` debits the wallet (space_allocation); `withdraw`
 * credits it back (space_release). The other side is the Space itself,
 * recorded on the operation — the Space's balance is derived from
 * these entries, never stored.
 */
export function spaceMoveDraft(
  input: Base & {
    walletId: string;
    space: Pick<MoneySpace, "id" | "name">;
    amount: number;
    direction: "add" | "withdraw";
  },
): OperationDraft {
  const counterparty: LedgerCounterparty = {
    kind: "space",
    id: input.space.id,
    name: input.space.name,
  };
  const add = input.direction === "add";
  const description = add ? `Added to ${input.space.name}` : `Moved from ${input.space.name}`;
  return {
    id: input.id,
    type: "space",
    actorId: input.actorId,
    at: input.at,
    description,
    legs: [
      {
        walletId: input.walletId,
        entryType: add ? "space_allocation" : "space_release",
        direction: add ? "debit" : "credit",
        amount: input.amount,
        counterparty,
        description,
        spaceId: input.space.id,
      },
      { external: counterparty, direction: add ? "credit" : "debit", amount: input.amount },
    ],
  };
}

/** A money request marked paid: money in from a fictional person. */
export function settlementDraft(
  input: Base & {
    walletId: string;
    requestId: string;
    amount: number;
    from: LedgerCounterparty;
    description: string;
  },
): OperationDraft {
  return {
    id: input.id,
    type: "request_settlement",
    actorId: input.actorId,
    at: input.at,
    description: input.description,
    requestId: input.requestId,
    recipientId: input.from.id,
    legs: [
      { external: input.from, direction: "debit", amount: input.amount },
      {
        walletId: input.walletId,
        entryType: "payment_received",
        direction: "credit",
        amount: input.amount,
        counterparty: input.from,
        description: input.description,
        requestId: input.requestId,
      },
    ],
  };
}

/** Entries of one wallet (re-exported for callers of this module). */
export { walletEntries };
