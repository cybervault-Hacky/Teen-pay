"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOptionalAuth } from "@/auth/provider";
import type { AuthEvent } from "@/auth/types";
import type {
  AccountProfile,
  ApprovalRequest,
  PocketMoneyFrequency,
  ApprovalRule,
  NewAccountInput,
  SecurityEvent,
  SpendingLimits,
  User,
  UserRole,
  UsernameCheck,
  WalletStatus,
} from "@/domain";
import { makeId, makeInviteCode } from "@/lib/ids";
import {
  cancelAccountDeletion,
  checkUsernameAvailability,
  createAccount,
  familyIdForInviteCode,
  inviteCodesInUse,
  recordSecurityEvent,
  requestAccountDeletion,
  sandboxSwitchTarget,
  securityEventsFor,
} from "./accounts";
import {
  acceptInviteTransition,
  cancelInviteTransition,
  claimInviteTransition,
  createInviteTransition,
  disconnectTransition,
  releaseInviteTransition,
  updateGuardianNotificationsTransition,
  updateSpendingRulesTransition,
} from "./family-transitions";
import {
  cancelPocketMoneyScheduleTransition,
  createPocketMoneyScheduleTransition,
  executeDuePocketMoneyTransition,
  pausePocketMoneyScheduleTransition,
  resumePocketMoneyScheduleTransition,
  updatePocketMoneyScheduleTransition,
  type ExecutePocketMoneyResult,
  type PocketMoneyScheduleResult,
  type UpdatePocketMoneyInput,
} from "./allowance-transitions";
import {
  createLocalRepository,
  describeLoadOutcome,
  type SandboxRepository,
} from "./repository";
import { accessMemberships, accountProfile, findAccount, mergeScope, scopeFor, type ScopeInfo } from "./scope";
import { SEED_TEEN_ID, buildSeedDatabase } from "./seed";
import {
  archiveSpaceTransition,
  createSpaceTransition,
  moveSpaceMoneyTransition,
  updateSpaceTransition,
  type ArchiveResult,
  type CreateSpaceInput,
  type SpaceMoveResult,
  type UpdateSpaceInput,
} from "./space-transitions";
import {
  cancelApprovalTransition,
  createRequestTransition,
  decideApprovalTransition,
  markAllNotificationsRead,
  markNotificationRead,
  payTransition,
  refundTransition,
  respondRequestTransition,
  sendAllowanceTransition,
  setWalletStatusTransition,
  type PayOutcome,
  type TransitionOutput,
} from "./transitions";
import {
  acceptMoneyRequestTransition,
  approveTransferTransition,
  cancelMoneyRequestTransition,
  createMoneyRequestTransition,
  declineMoneyRequestTransition,
  expireMoneyRequestsTransition,
  sendMoneyTransition,
  type AcceptMoneyRequestOutcome,
  type MoneyRequestOutcome,
  type PeerOutput,
  type SendMoneyOutcome,
} from "./peer-transitions";
import { lookupPeer, searchPeers } from "./peer";
import {
  addContactTransition,
  isFavourite,
  lookupContact,
  removeContactTransition,
  selectContactViews,
  type AddContactOutcome,
  type ContactView,
} from "./contacts";
import {
  acceptFriendRequestTransition,
  cancelFriendRequestTransition,
  declineFriendRequestTransition,
  friendCircleFor,
  friendLookup,
  removeFriendTransition,
  sendFriendRequestTransition,
  type AcceptFriendRequestOutcome,
  type SendFriendRequestOutcome,
} from "./friends";
import { qrIdentityFor, resolveQrRecipient, type QrIdentity } from "./qr";
import {
  changeTeenPayIdTransition,
  checkTeenPayIdAvailability,
  identityProfileFor,
  type ChangeTeenPayIdOutcome,
} from "./teenpay-id";
import { coachReportFor } from "./coach";
import {
  advanceMissionTransition,
  missionBoardFor,
  missionDetailFor,
  startMissionTransition,
} from "./missions";
import type { CoachPeriod, CoachReport, FriendCircle, FriendPreview, IdentityProfile, MissionBoard, MissionView, PeerProfile, TeenPayIdAvailability } from "@/domain";
import type { SandboxDatabase, SandboxError, SandboxResult, SandboxState } from "./types";

/**
 * The single client-side boundary between the UI and sandbox data.
 *
 *   AuthProvider (who is acting) ──▶ SandboxProvider ──▶ repository
 *
 * Two contexts:
 *  - `useSandboxData()` — account-level things that exist whether or
 *    not anyone is signed in: the sandbox account directory, username
 *    checks, account creation, reset.
 *  - `useSandbox()` — the signed-in account's scoped view (its family,
 *    the wallet it may see, its notifications) plus actions. Every
 *    action runs as the session's account; authorization is decided
 *    in the domain from memberships, never from what the UI shows.
 *
 * Components never touch storage, the ledger or write paths directly.
 */

export interface SandboxActions {
  /**
   * Send a sandbox payment. `idempotencyId` is generated once when
   * the user reaches review; replaying it is a no-op. The outcome
   * says whether it completed or is waiting for guardian approval.
   */
  pay: (input: {
    idempotencyId?: string;
    recipientId: string;
    amount: number;
    note?: string;
  }) => SandboxResult<PayOutcome>;
  createRequest: (input: {
    idempotencyId?: string;
    recipientId: string;
    amount: number;
    note?: string;
  }) => SandboxResult;
  respondToRequest: (
    requestId: string,
    response: "paid" | "cancelled",
  ) => SandboxResult;
  /**
   * Money actions take an `idempotencyId` generated once per user
   * intent (e.g. when a confirm sheet opens); a double click, retry
   * or stale re-submit with the same id changes nothing.
   */
  sendAllowance: (input: { amount: number; note?: string; idempotencyId?: string }) => SandboxResult;

  // ── Money Spaces (the owner only; see space-transitions.ts) ──
  /** Creates a goal or custom Space; `idempotencyId` becomes its id. */
  createSpace: (
    input: Omit<CreateSpaceInput, "spaceId" | "actorId" | "at"> & { idempotencyId?: string },
  ) => SandboxResult<SpaceMoveResult>;
  updateSpace: (
    spaceId: string,
    changes: Omit<UpdateSpaceInput, "spaceId" | "actorId" | "at">,
  ) => SandboxResult<{ spaceId: string }>;
  /** Moves any balance back to available, then archives. */
  archiveSpace: (spaceId: string, idempotencyId?: string) => SandboxResult<ArchiveResult>;
  /** Available → Space. */
  addToSpace: (spaceId: string, amount: number, idempotencyId?: string) => SandboxResult<SpaceMoveResult>;
  /** Space → available. */
  withdrawFromSpace: (
    spaceId: string,
    amount: number,
    idempotencyId?: string,
  ) => SandboxResult<SpaceMoveResult>;
  /** Sandbox only: simulate the recipient refunding a payment in full. */
  simulateRefund: (entryId: string) => SandboxResult<{ reference: string }>;
  /** Sandbox safety switch: freeze or unfreeze a teen wallet. */
  setWalletFrozen: (walletId: string, frozen: boolean) => SandboxResult<{ status: WalletStatus }>;
  /** Marks the current user's notifications read. Never affects money. */
  markAllNotificationsRead: () => void;
  markNotificationRead: (id: string) => void;

  // ── Sandbox role switch (transparent demo control, not sign-in) ──
  switchRole: (role: UserRole) => SandboxResult<{ userId: string }>;

  // ── Family linking ──
  createFamilyInvite: () => SandboxResult<{ code: string }>;
  cancelFamilyInvite: () => SandboxResult;
  claimFamilyInvite: (code: string) => SandboxResult<{ teenId: string }>;
  releaseFamilyInvite: (teenId: string) => SandboxResult;
  acceptFamilyInvite: (teenId: string) => SandboxResult;
  disconnectFamily: (teenId: string) => SandboxResult;

  // ── Guardian controls ──
  updateSpendingRules: (input: {
    teenId: string;
    limits: SpendingLimits;
    approval: ApprovalRule;
  }) => SandboxResult;
  updateGuardianNotifications: (input: {
    teenId: string;
    payments: boolean;
    savings: boolean;
  }) => SandboxResult;

  // ── Pocket Money Autopilot (the paying parent; see allowance-transitions.ts) ──
  /**
   * Creates a recurring schedule from the parent's wallet to the teen's.
   * `idempotencyId` (generated once per form) becomes its id, so a
   * double submit creates one schedule. Wallets are derived in the
   * engine; any echoed ids are verified, never trusted.
   */
  createPocketMoneySchedule: (input: {
    idempotencyId?: string;
    teenId: string;
    amount: number;
    frequency: PocketMoneyFrequency;
    dayOfWeek: number;
    dayOfMonth: number;
    startDate: string;
    endDate?: string;
    sourceWalletId?: string;
    destinationWalletId?: string;
  }) => SandboxResult<PocketMoneyScheduleResult>;
  /** Edits the plan; refused when `expectedVersion` is stale. */
  updatePocketMoneySchedule: (
    input: Omit<UpdatePocketMoneyInput, "actorId" | "at">,
  ) => SandboxResult<PocketMoneyScheduleResult>;
  pausePocketMoneySchedule: (
    scheduleId: string,
    expectedVersion?: number,
  ) => SandboxResult<PocketMoneyScheduleResult>;
  resumePocketMoneySchedule: (
    scheduleId: string,
    expectedVersion?: number,
  ) => SandboxResult<PocketMoneyScheduleResult>;
  cancelPocketMoneySchedule: (
    scheduleId: string,
    expectedVersion?: number,
  ) => SandboxResult<PocketMoneyScheduleResult>;
  /**
   * Sandbox execution — nothing runs on a timer. Processes due
   * occurrences as of `asOf` (default: now); each occurrence at most
   * once, ever.
   */
  executeDuePocketMoney: (input?: {
    asOf?: string;
    scheduleId?: string;
  }) => SandboxResult<ExecutePocketMoneyResult>;

  // ── TeenPay-to-TeenPay money (see peer-transitions.ts) ──
  /**
   * Sends from the viewer's available balance to another TeenPay teen,
   * named by TeenPay ID ("@meera"). `idempotencyKey` is generated once
   * per send (when review opens); a repeat returns the original result
   * and never posts twice. Above the guardian's threshold, it waits
   * for approval instead — nothing moves until then.
   */
  sendMoney: (input: {
    recipient: string;
    amount: number;
    note?: string;
    idempotencyKey: string;
  }) => SandboxResult<SendMoneyOutcome>;
  /** Asks another teen for money. Moves nothing. */
  createMoneyRequest: (input: {
    payer: string;
    amount: number;
    note?: string;
    idempotencyKey: string;
  }) => SandboxResult<MoneyRequestOutcome>;
  /** The payer pays a pending request — exactly once. */
  acceptMoneyRequest: (requestId: string) => SandboxResult<AcceptMoneyRequestOutcome>;
  /** The payer declines. No money moves. */
  declineMoneyRequest: (requestId: string) => SandboxResult<{ status: "declined" }>;
  /** The requester withdraws a pending request. No money moves. */
  cancelMoneyRequest: (requestId: string) => SandboxResult<{ status: "cancelled" }>;
  /**
   * Records expiry for the viewer's requests past their 7 days (no
   * timer: expiry is computed from timestamps; this only writes it down).
   */
  expireMoneyRequests: () => SandboxResult<{ expired: number }>;

  // ── QR & favourites (discovery only — see qr.ts, contacts.ts) ──
  /** Saves an eligible TeenPay teen to the viewer's favourites. */
  addContact: (teenPayId: string, idempotencyKey?: string) => SandboxResult<AddContactOutcome>;
  /** Removes one of the viewer's favourites. Touches nothing else. */
  removeContact: (teenPayId: string) => SandboxResult<{ removed: string }>;
  /** Scanned or pasted text → a safe recipient profile (untrusted input). */
  resolveQrIdentity: (payload: string) => SandboxResult<PeerProfile>;
  /** The viewer's own QR: `teenpay://user/@handle?v=1` and their public profile. */
  createQrPayload: () => SandboxResult<QrIdentity>;
  /**
   * Resolves a QR and returns where the existing Send Money flow opens
   * with that recipient preselected. Moves nothing: the person still
   * enters an amount, reviews and confirms through `sendMoney`.
   */
  startQrPayment: (payload: string) => SandboxResult<{ recipient: PeerProfile; href: string }>;
  /** Same, into the existing Request Money flow (`createMoneyRequest`). */
  startQrRequest: (payload: string) => SandboxResult<{ recipient: PeerProfile; href: string }>;

  // ── Friend Circles (trusted peers only — see friends.ts) ──
  /** The signed-in teen's circle: friends, incoming and sent requests. */
  friendCircle: () => SandboxResult<FriendCircle>;
  /**
   * Safe discovery: one exact TeenPay ID → a minimal preview (public
   * profile + relationship state), or the viewer's own ID as a
   * neutral "self" result. Parents and signed-out sessions are refused.
   */
  friendLookup: (teenPayId: string) => SandboxResult<FriendPreview>;
  /**
   * Sends a friend request to an eligible teen. `requestId` is
   * generated once per action; a repeat answers from the record and
   * never creates a second request. Moves nothing — friendship never
   * implies payment authorization.
   */
  sendFriendRequest: (
    teenPayId: string,
    requestId?: string,
  ) => SandboxResult<SendFriendRequestOutcome>;
  /** The recipient accepts a pending request. Idempotent. */
  acceptFriendRequest: (friendshipId: string) => SandboxResult<AcceptFriendRequestOutcome>;
  /** The recipient declines. Quiet — no notification. */
  declineFriendRequest: (friendshipId: string) => SandboxResult<{ status: "declined" }>;
  /** The requester withdraws their own pending request. Quiet. */
  cancelFriendRequest: (friendshipId: string) => SandboxResult<{ status: "cancelled" }>;
  /**
   * Either friend ends the friendship. Changes the relationship only —
   * never history, payments, requests, Spaces or rules.
   */
  removeFriend: (teenPayId: string) => SandboxResult<{ removed: string }>;

  // ── TeenPay ID (identity only — see identity.ts) ──
  /**
   * Structured availability for one TeenPay ID (`available`, `taken`,
   * `reserved`, `invalid`). Never reveals who holds a taken ID.
   */
  checkTeenPayId: (teenPayId: string) => SandboxResult<TeenPayIdAvailability>;
  /**
   * The canonical identity lookup: one exact TeenPay ID → a safe
   * public profile (handle, name, initials + relationship and action
   * state), or the directory's neutral "No TeenPay user found."
   */
  identitySearch: (teenPayId: string) => SandboxResult<IdentityProfile>;
  /**
   * Changes the signed-in teen's own TeenPay ID — the alias only.
   * The account id, wallets, ledger, friendships, requests and
   * favourites are untouched; a freed ID becomes claimable again.
   */
  changeTeenPayId: (teenPayId: string) => SandboxResult<ChangeTeenPayIdOutcome>;

  // ── Money Coach (read-only — see coach.ts) ──
  /**
   * The signed-in teen's Money Coach report for a period: summary,
   * insights, goals and lessons, derived from their own wallet. Reads
   * only — it can't move money or change anything. Parents get
   * `not_permitted`; a signed-out (stale) screen gets `not_signed_in`.
   */
  coachReport: (period: CoachPeriod) => SandboxResult<CoachReport>;

  // ── Money Missions (learning progress only — see missions.ts) ──
  /** The signed-in teen's missions, statuses and progress. Read-only. */
  missionBoard: () => SandboxResult<MissionBoard>;
  /** One mission as the signed-in teen sees it. Read-only. */
  missionDetail: (missionId: string) => SandboxResult<MissionView>;
  /** Starts a mission. Records learning progress only — never money. */
  startMission: (missionId: string) => SandboxResult<MissionView>;
  /**
   * Finishes the current step of a started mission after the engine
   * checks it (order, answer, evidence). Records learning progress
   * only; a repeat changes nothing.
   */
  advanceMission: (missionId: string, stepId: string, answer?: number) => SandboxResult<MissionView>;

  // ── Approvals ──
  decideApproval: (
    approvalId: string,
    decision: "approve" | "decline",
  ) => SandboxResult<{ status: ApprovalRequest["status"] }>;
  cancelApproval: (approvalId: string) => SandboxResult;

  /** Returns the whole sandbox to its deterministic initial state and signs out. */
  resetSandbox: () => void;
}

export type StorageStatus = "loading" | "ready" | "unavailable";

export interface SandboxDataValue {
  /** False until stored data has been read (SSR + first render use the seed). */
  ready: boolean;
  storageStatus: StorageStatus;
  /** A one-off message about loading/migrating stored data. */
  storageNotice: string | null;
  dismissStorageNotice: () => void;
  /** Active sandbox accounts on this device (for "Continue as"). */
  directory: User[];
  findAccount: (accountId: string) => User | null;
  /** The account with its derived family membership. */
  accountProfile: (accountId: string) => AccountProfile | null;
  checkUsername: (raw: string) => UsernameCheck;
  createAccount: (input: NewAccountInput) => SandboxResult<{ account: User }>;
  requestAccountDeletion: (accountId: string) => SandboxResult;
  cancelAccountDeletion: (accountId: string) => void;
  securityEvents: (accountId: string) => SecurityEvent[];
  resetSandbox: () => void;
}

export interface SandboxContextValue {
  state: SandboxState;
  storageStatus: StorageStatus;
  actions: SandboxActions;
  /** The signed-in account. */
  viewer: User;
  /** What this view was granted (family, wallet). */
  scope: ScopeInfo;
  /** Who "Switch role" would move to, per role. */
  switchTargets: Record<UserRole, User | null>;
  /**
   * Finding people to send to or request from: only eligible TeenPay
   * teens, only display-safe profiles (@handle, name, initials) — no
   * account, wallet or family details. Never includes the viewer.
   */
  peers: {
    search: (query: string) => PeerProfile[];
    lookup: (teenPayId: string) => PeerProfile | null;
  };
  /** The viewer's own TeenPay QR (null for parents / ineligible accounts). */
  qr: QrIdentity | null;
  /**
   * The signed-in teen's Friend Circle (null for parents — a parent
   * never sees a teen's private circle): trusted friends, incoming
   * requests and sent requests, resolved to public profiles only.
   */
  friendCircle: FriendCircle | null;
  /**
   * The viewer's favourites, resolved against current state (public
   * profiles only; `available: false` for people who can't take part).
   */
  contacts: {
    list: ContactView[];
    isFavourite: (teenPayId: string) => boolean;
    /** A favourite's current profile, only while in the list and eligible. */
    lookup: (teenPayId: string) => PeerProfile | null;
  };
}

const SandboxDataContext = createContext<SandboxDataValue | null>(null);
const SandboxContext = createContext<SandboxContextValue | null>(null);

const SOMETHING_WENT_WRONG: SandboxError = {
  code: "invalid_transition",
  message: "Something went wrong, so nothing was changed. Please try again.",
};

const NOT_SIGNED_IN: SandboxError = {
  code: "not_signed_in",
  message: "Your session has ended. Please sign in again.",
};

const ACCOUNT_UNAVAILABLE: SandboxError = {
  code: "account_unavailable",
  message: "This account isn't available. Please sign in again.",
};

export function SandboxProvider({
  children,
  viewerId: initialViewerId,
  repository: providedRepository,
}: {
  children: React.ReactNode;
  /**
   * Without an AuthProvider (isolated tests), the account to view as.
   * Defaults to the seed teen. Ignored when an AuthProvider exists.
   */
  viewerId?: string;
  repository?: SandboxRepository;
}) {
  const auth = useOptionalAuth();
  const [repository] = useState<SandboxRepository>(
    () => providedRepository ?? createLocalRepository(),
  );

  // SSR and the first client render use the deterministic seed
  // (hydration-safe). Stored data is applied after mount.
  const [db, setDb] = useState<SandboxDatabase>(buildSeedDatabase);
  const [ready, setReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("loading");
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [localViewer, setLocalViewer] = useState(initialViewerId ?? SEED_TEEN_ID);

  const viewerId: string | null = auth
    ? auth.status === "authenticated" && auth.session
      ? auth.session.accountId
      : null
    : localViewer;

  // Latest values, including changes made earlier in the same tick —
  // so a double click sees the first click's result.
  const dbRef = useRef(db);
  dbRef.current = db;
  const viewerRef = useRef(viewerId);
  viewerRef.current = viewerId;
  const authRef = useRef(auth);
  authRef.current = auth;

  const commit = useCallback((next: SandboxDatabase) => {
    if (next === dbRef.current) return;
    dbRef.current = next;
    setDb(next);
  }, []);

  // Load once.
  useEffect(() => {
    const { db: loaded, outcome } = repository.load();
    dbRef.current = loaded;
    setDb(loaded);
    setReady(true);
    setStorageStatus(outcome.kind === "unavailable" ? "unavailable" : "ready");
    setStorageNotice(describeLoadOutcome(outcome));
  }, [repository]);

  // Save on every change after loading.
  useEffect(() => {
    if (!ready || storageStatus === "unavailable") return;
    if (!repository.save(db)) setStorageStatus("unavailable");
  }, [db, ready, storageStatus, repository]);

  // Record sign-in / sign-out / expiry as account security events.
  const subscribe = auth?.subscribe;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event: AuthEvent) => {
      commit(
        recordSecurityEvent(dbRef.current, event.accountId, event.type, event.at, event.sessionId),
      );
    });
  }, [subscribe, commit]);

  const scope = useMemo(
    () => (viewerId ? scopeFor(db, viewerId) : null),
    [db, viewerId],
  );

  // A session pointing at an account that's gone or closed ends —
  // it never falls back to someone else's data.
  const signOut = auth?.signOut;
  useEffect(() => {
    if (ready && signOut && viewerId && !scope) signOut("account_unavailable");
  }, [ready, signOut, viewerId, scope]);

  const actions = useMemo<SandboxActions>(() => {
    /**
     * Runs a pure transition on the acting account's scope and merges
     * the result back. Unexpected errors become a friendly message —
     * nothing half-applied, no internals shown.
     */
    function dispatch<T>(
      transition: (current: SandboxState) => TransitionOutput<T>,
      options: { familyId?: string } = {},
    ): SandboxResult<T> {
      const actor = viewerRef.current;
      if (!actor) return { ok: false, error: NOT_SIGNED_IN };
      const current = scopeFor(dbRef.current, actor, options);
      if (!current) return { ok: false, error: ACCOUNT_UNAVAILABLE };
      let output: TransitionOutput<T>;
      try {
        output = transition(current.state);
      } catch {
        return { ok: false, error: SOMETHING_WENT_WRONG };
      }
      if (output.result.ok && output.state !== current.state) {
        // All-or-nothing: if the merge refuses (e.g. an attempt to
        // rewrite history), nothing is written and no success shown.
        let merged: SandboxDatabase;
        try {
          merged = mergeScope(dbRef.current, current.info, current.state, output.state);
        } catch {
          return { ok: false, error: SOMETHING_WENT_WRONG };
        }
        commit(merged);
      }
      return output.result;
    }

    /**
     * Runs a database-level peer transition as the acting account.
     * TeenPay transfers cross families, so they can't run inside one
     * family scope; the engine authorizes the actor itself (and posts
     * through the one ledger write path). Same guarantees as
     * `dispatch`: signed in, active account, all-or-nothing.
     */
    function dispatchDb<T>(
      transition: (current: SandboxDatabase, actorId: string, at: string) => PeerOutput<T>,
    ): SandboxResult<T> {
      const actor = viewerRef.current;
      if (!actor) return { ok: false, error: NOT_SIGNED_IN };
      if (!scopeFor(dbRef.current, actor)) return { ok: false, error: ACCOUNT_UNAVAILABLE };
      let output: PeerOutput<T>;
      try {
        output = transition(dbRef.current, actor, new Date().toISOString());
      } catch {
        return { ok: false, error: SOMETHING_WENT_WRONG };
      }
      if (output.result.ok) commit(output.db);
      return output.result;
    }

    /**
     * Read-only, as the acting account: same "signed in, active" gate
     * as writes, so a stale screen can't read through a dead session.
     */
    function readDb<T>(read: (current: SandboxDatabase, actorId: string) => SandboxResult<T>): SandboxResult<T> {
      const actor = viewerRef.current;
      if (!actor) return { ok: false, error: NOT_SIGNED_IN };
      if (!scopeFor(dbRef.current, actor)) return { ok: false, error: ACCOUNT_UNAVAILABLE };
      try {
        return read(dbRef.current, actor);
      } catch {
        return { ok: false, error: SOMETHING_WENT_WRONG };
      }
    }

    /** QR → recipient → the existing flow's URL (preselected, not sent). */
    function startFromQr(payload: string, path: "/send" | "/request") {
      return readDb((db, actorId) => {
        const resolved = resolveQrRecipient(db, actorId, payload);
        if (!resolved.ok) return resolved;
        const handle = resolved.value.handle.replace(/^@/, "");
        return {
          ok: true as const,
          value: { recipient: resolved.value, href: `${path}?to=${encodeURIComponent(handle)}&via=qr` },
        };
      });
    }

    function update(fn: (current: SandboxState) => SandboxState): void {
      dispatch((s) => {
        const next = fn(s);
        return { state: next, result: { ok: true, value: undefined } };
      });
    }

    return {
      pay: (input) =>
        dispatch((s) =>
          payTransition(s, {
            entryId: input.idempotencyId ?? makeId("pay"),
            recipientId: input.recipientId,
            amount: input.amount,
            note: input.note,
          }),
        ),
      createRequest: (input) =>
        dispatch((s) =>
          createRequestTransition(s, {
            requestId: input.idempotencyId ?? makeId("req"),
            recipientId: input.recipientId,
            amount: input.amount,
            note: input.note,
          }),
        ),
      respondToRequest: (requestId, response) =>
        dispatch((s) => respondRequestTransition(s, { requestId, response })),
      sendAllowance: (input) => {
        const operationId = input.idempotencyId ?? makeId("allow");
        return dispatch((s) =>
          sendAllowanceTransition(s, { operationId, amount: input.amount, note: input.note }),
        );
      },
      createSpace: ({ idempotencyId, ...input }) =>
        dispatch((s) =>
          createSpaceTransition(s, { ...input, spaceId: idempotencyId ?? makeId("spc") }),
        ),
      updateSpace: (spaceId, changes) =>
        dispatch((s) => updateSpaceTransition(s, { ...changes, spaceId })),
      archiveSpace: (spaceId, idempotencyId) =>
        dispatch((s) =>
          archiveSpaceTransition(s, { spaceId, operationId: idempotencyId ?? makeId("spcop") }),
        ),
      addToSpace: (spaceId, amount, idempotencyId) =>
        dispatch((s) =>
          moveSpaceMoneyTransition(s, {
            spaceId,
            amount,
            direction: "add",
            operationId: idempotencyId ?? makeId("spcop"),
          }),
        ),
      withdrawFromSpace: (spaceId, amount, idempotencyId) =>
        dispatch((s) =>
          moveSpaceMoneyTransition(s, {
            spaceId,
            amount,
            direction: "withdraw",
            operationId: idempotencyId ?? makeId("spcop"),
          }),
        ),
      simulateRefund: (entryId) => dispatch((s) => refundTransition(s, { entryId })),
      setWalletFrozen: (walletId, frozen) =>
        dispatch((s) =>
          setWalletStatusTransition(s, { walletId, status: frozen ? "frozen" : "active" }),
        ),
      markAllNotificationsRead: () =>
        update((s) => markAllNotificationsRead(s, s.session.currentUserId)),
      markNotificationRead: (id) => update((s) => markNotificationRead(s, id)),

      switchRole: (role) => {
        const actor = viewerRef.current;
        if (!actor) return { ok: false, error: NOT_SIGNED_IN };
        const target = sandboxSwitchTarget(dbRef.current, actor, role);
        if (!target) {
          return {
            ok: false,
            error: { code: "unknown_user", message: `There's no ${role} account in this sandbox yet.` },
          };
        }
        if (target.id === actor) return { ok: true, value: { userId: actor } };
        const currentAuth = authRef.current;
        if (currentAuth) {
          const result = currentAuth.switchAccount({
            method: "sandbox",
            accountId: target.id,
            role: target.role,
          });
          if (!result.ok) {
            return { ok: false, error: { code: "not_signed_in", message: result.message } };
          }
        } else {
          setLocalViewer(target.id);
        }
        viewerRef.current = target.id;
        return { ok: true, value: { userId: target.id } };
      },

      createFamilyInvite: () => {
        const used = inviteCodesInUse(dbRef.current);
        let code = makeInviteCode();
        for (let i = 0; i < 20 && used.has(code); i += 1) code = makeInviteCode();
        return dispatch((s) => createInviteTransition(s, { code }));
      },
      cancelFamilyInvite: () => dispatch((s) => cancelInviteTransition(s)),
      claimFamilyInvite: (code) => {
        const actor = viewerRef.current;
        const familyId = familyIdForInviteCode(dbRef.current, code);
        if (actor && familyId) {
          const elsewhere = accessMemberships(dbRef.current, actor).some(
            (m) => m.membership.status === "active" && m.family.id !== familyId,
          );
          if (elsewhere) {
            return {
              ok: false,
              error: {
                code: "invalid_transition",
                message:
                  "This sandbox supports one family per parent account for now. Disconnect first, or use another parent account.",
              },
            };
          }
        }
        return dispatch((s) => claimInviteTransition(s, { code }), familyId ? { familyId } : {});
      },
      releaseFamilyInvite: (teenId) => dispatch((s) => releaseInviteTransition(s, { teenId })),
      acceptFamilyInvite: (teenId) => dispatch((s) => acceptInviteTransition(s, { teenId })),
      disconnectFamily: (teenId) => dispatch((s) => disconnectTransition(s, { teenId })),

      updateSpendingRules: (input) => dispatch((s) => updateSpendingRulesTransition(s, input)),
      updateGuardianNotifications: (input) =>
        dispatch((s) => updateGuardianNotificationsTransition(s, input)),

      createPocketMoneySchedule: ({ idempotencyId, ...input }) => {
        const scheduleId = idempotencyId ?? makeId("pms");
        return dispatch((s) => createPocketMoneyScheduleTransition(s, { ...input, scheduleId }));
      },
      updatePocketMoneySchedule: (input) =>
        dispatch((s) => updatePocketMoneyScheduleTransition(s, input)),
      pausePocketMoneySchedule: (scheduleId, expectedVersion) =>
        dispatch((s) => pausePocketMoneyScheduleTransition(s, { scheduleId, expectedVersion })),
      resumePocketMoneySchedule: (scheduleId, expectedVersion) =>
        dispatch((s) => resumePocketMoneyScheduleTransition(s, { scheduleId, expectedVersion })),
      cancelPocketMoneySchedule: (scheduleId, expectedVersion) =>
        dispatch((s) => cancelPocketMoneyScheduleTransition(s, { scheduleId, expectedVersion })),
      executeDuePocketMoney: (input = {}) =>
        dispatch((s) => executeDuePocketMoneyTransition(s, input)),

      sendMoney: (input) =>
        dispatchDb((db, actorId, at) => sendMoneyTransition(db, { ...input, actorId, at })),
      createMoneyRequest: (input) =>
        dispatchDb((db, actorId, at) => createMoneyRequestTransition(db, { ...input, actorId, at })),
      acceptMoneyRequest: (requestId) =>
        dispatchDb((db, actorId, at) => acceptMoneyRequestTransition(db, { actorId, at, requestId })),
      declineMoneyRequest: (requestId) =>
        dispatchDb((db, actorId, at) => declineMoneyRequestTransition(db, { actorId, at, requestId })),
      cancelMoneyRequest: (requestId) =>
        dispatchDb((db, actorId, at) => cancelMoneyRequestTransition(db, { actorId, at, requestId })),
      expireMoneyRequests: () =>
        dispatchDb((db, actorId, at) => expireMoneyRequestsTransition(db, { actorId, at })),

      addContact: (teenPayId, idempotencyKey) => {
        const contactId = idempotencyKey ?? makeId("ctc");
        return dispatchDb((db, actorId, at) => addContactTransition(db, { actorId, at, teenPayId, contactId }));
      },
      removeContact: (teenPayId) =>
        dispatchDb((db, actorId, at) => removeContactTransition(db, { actorId, at, teenPayId })),

      friendCircle: () => readDb((db, actorId) => friendCircleFor(db, actorId)),
      friendLookup: (teenPayId) => readDb((db, actorId) => friendLookup(db, actorId, teenPayId)),
      sendFriendRequest: (teenPayId, requestId) => {
        const key = requestId ?? makeId("frd");
        return dispatchDb((db, actorId, at) =>
          sendFriendRequestTransition(db, { actorId, at, teenPayId, requestId: key }),
        );
      },
      acceptFriendRequest: (friendshipId) =>
        dispatchDb((db, actorId, at) => acceptFriendRequestTransition(db, { actorId, at, friendshipId })),
      declineFriendRequest: (friendshipId) =>
        dispatchDb((db, actorId, at) => declineFriendRequestTransition(db, { actorId, at, friendshipId })),
      cancelFriendRequest: (friendshipId) =>
        dispatchDb((db, actorId, at) => cancelFriendRequestTransition(db, { actorId, at, friendshipId })),
      removeFriend: (teenPayId) =>
        dispatchDb((db, actorId, at) => removeFriendTransition(db, { actorId, at, teenPayId })),

      checkTeenPayId: (teenPayId) =>
        readDb((db, actorId) => checkTeenPayIdAvailability(db, actorId, teenPayId)),
      identitySearch: (teenPayId) => readDb((db, actorId) => identityProfileFor(db, actorId, teenPayId)),
      changeTeenPayId: (teenPayId) =>
        dispatchDb((db, actorId, at) => changeTeenPayIdTransition(db, { actorId, at, teenPayId })),

      resolveQrIdentity: (payload) => readDb((db, actorId) => resolveQrRecipient(db, actorId, payload)),
      createQrPayload: () => readDb((db, actorId) => qrIdentityFor(db, actorId)),
      startQrPayment: (payload) => startFromQr(payload, "/send"),
      startQrRequest: (payload) => startFromQr(payload, "/request"),

      coachReport: (period) =>
        readDb((db, actorId) => coachReportFor(db, actorId, period, new Date().toISOString())),

      missionBoard: () => readDb((db, actorId) => missionBoardFor(db, actorId)),
      missionDetail: (missionId) => readDb((db, actorId) => missionDetailFor(db, actorId, missionId)),
      startMission: (missionId) =>
        dispatchDb((db, actorId, at) => startMissionTransition(db, { actorId, at, missionId })),
      advanceMission: (missionId, stepId, answer) =>
        dispatchDb((db, actorId, at) =>
          advanceMissionTransition(db, { actorId, at, missionId, stepId, ...(answer !== undefined ? { answer } : {}) }),
        ),

      decideApproval: (approvalId, decision) => {
        // Approving a TeenPay transfer executes across families, so it
        // runs in the peer engine (which re-checks everything). Declines
        // move nothing and stay on the family path.
        const actor = viewerRef.current;
        const approval = actor
          ? scopeFor(dbRef.current, actor)?.state.approvals.find((a) => a.id === approvalId)
          : undefined;
        if (approval?.kind === "transfer" && decision === "approve") {
          return dispatchDb((db, actorId, at) => approveTransferTransition(db, { actorId, at, approvalId }));
        }
        return dispatch((s) => decideApprovalTransition(s, { approvalId, decision }));
      },
      cancelApproval: (approvalId) => dispatch((s) => cancelApprovalTransition(s, { approvalId })),

      resetSandbox: () => resetRef.current(),
    };
    // Actions are stable by design: they read the latest values via refs.
  }, [commit]);

  const reset = useCallback(() => {
    // Sign out first so its security event lands in the old data,
    // then replace everything with the deterministic seed.
    authRef.current?.signOut("reset");
    const seed = repository.reset();
    dbRef.current = seed;
    setDb(seed);
    setStorageStatus("ready");
    setStorageNotice(null);
    if (!authRef.current) {
      setLocalViewer(initialViewerId ?? SEED_TEEN_ID);
      viewerRef.current = initialViewerId ?? SEED_TEEN_ID;
    }
  }, [repository, initialViewerId]);
  const resetRef = useRef(reset);
  resetRef.current = reset;

  const dataValue = useMemo<SandboxDataValue>(() => {
    const now = () => new Date().toISOString();
    return {
      ready,
      storageStatus,
      storageNotice,
      dismissStorageNotice: () => setStorageNotice(null),
      directory: db.accounts.filter((a) => a.status === "active"),
      findAccount: (accountId) => findAccount(dbRef.current, accountId),
      accountProfile: (accountId) => accountProfile(dbRef.current, accountId),
      checkUsername: (raw) => checkUsernameAvailability(dbRef.current, raw),
      createAccount: (input) => {
        let result: ReturnType<typeof createAccount>;
        try {
          result = createAccount(dbRef.current, input, now());
        } catch {
          return { ok: false, error: SOMETHING_WENT_WRONG };
        }
        if ("code" in result) return { ok: false, error: result };
        commit(result.db);
        return { ok: true, value: { account: result.account } };
      },
      requestAccountDeletion: (accountId) => {
        const result = requestAccountDeletion(dbRef.current, accountId, now());
        if ("code" in result) return { ok: false, error: result };
        commit(result);
        return { ok: true, value: undefined };
      },
      cancelAccountDeletion: (accountId) =>
        commit(cancelAccountDeletion(dbRef.current, accountId, now())),
      securityEvents: (accountId) => securityEventsFor(db, accountId),
      resetSandbox: reset,
    };
  }, [db, ready, storageStatus, storageNotice, commit, reset]);

  const value = useMemo<SandboxContextValue | null>(() => {
    if (!scope || !viewerId) return null;
    const viewer = scope.state.users.find((u) => u.id === viewerId);
    if (!viewer) return null;
    return {
      state: scope.state,
      storageStatus,
      actions,
      viewer,
      scope: scope.info,
      switchTargets: {
        teen: sandboxSwitchTarget(db, viewerId, "teen"),
        parent: sandboxSwitchTarget(db, viewerId, "parent"),
      },
      peers: {
        search: (query) => searchPeers(db, viewerId, query),
        lookup: (teenPayId) => lookupPeer(db, viewerId, teenPayId),
      },
      qr: (() => {
        const identity = qrIdentityFor(db, viewerId);
        return identity.ok ? identity.value : null;
      })(),
      friendCircle: (() => {
        if (viewer.role !== "teen") return null;
        const circle = friendCircleFor(db, viewerId);
        return circle.ok ? circle.value : null;
      })(),
      contacts: {
        list: selectContactViews(db, viewerId),
        isFavourite: (teenPayId) => isFavourite(db, viewerId, teenPayId),
        lookup: (teenPayId) => lookupContact(db, viewerId, teenPayId),
      },
    };
  }, [scope, viewerId, storageStatus, actions, db]);

  return (
    <SandboxDataContext.Provider value={dataValue}>
      <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>
    </SandboxDataContext.Provider>
  );
}

/** Account-level sandbox data; available signed in or out. */
export function useSandboxData(): SandboxDataValue {
  const context = useContext(SandboxDataContext);
  if (!context) throw new Error("useSandboxData must be used within a SandboxProvider");
  return context;
}

/**
 * The signed-in account's view. Only use below the auth gate — it
 * throws when there's no active session.
 */
export function useSandbox(): SandboxContextValue {
  const context = useContext(SandboxContext);
  if (!context) {
    throw new Error("useSandbox needs a SandboxProvider and a signed-in account");
  }
  return context;
}

/**
 * For app chrome that may render without a session: null instead of
 * throwing.
 */
export function useOptionalSandbox(): SandboxContextValue | null {
  return useContext(SandboxContext);
}
