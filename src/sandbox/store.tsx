/**
 * Sandbox store — the single client-side boundary for financial state.
 *
 * UI components consume typed selectors + actions through `useSandbox()`
 * and never touch localStorage or mutate entries directly. Actions run
 * the pure ledger engine against a state snapshot (StrictMode-safe),
 * then commit + persist atomically.
 *
 * Phase 17+ replaces this provider with a backend-backed implementation
 * behind the same hook shape — screens stay untouched.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppNotification,
  Household,
  LedgerSpace,
  Merchant,
  MoneyRequest,
  ParentProfile,
  SavingsGoal,
  TeenProfile,
  TeenWallet,
  Transaction,
  TrustedRecipient,
} from "@/domain";
import {
  goalBlueprints,
  mockHousehold,
  mockMerchants,
  mockRecipients,
  mockTeen,
} from "@/data/mock";
import { isGoalComplete } from "@/domain";
import { formatINR } from "@/lib/format";
import { validateTransferPaise } from "./amounts";
import { newOperationKey, uid } from "./ids";
import {
  postAllowance,
  postGoalContribution,
  postPayment,
  postSpaceMove,
  type LedgerEvent,
  type PostOutcome,
} from "./ledger";
import { deriveGoals, deriveWallet, projectTransactions } from "./projection";
import { createSeedState } from "./seed";
import {
  clearPersistedState,
  loadPersistedState,
  savePersistedState,
  type SandboxState,
  type StorageIssue,
  type StorageLike,
} from "./storage";

export type ActionResult<T extends object | void = void> = T extends void
  ? { ok: true } | { ok: false; error: string }
  : ({ ok: true } & T) | { ok: false; error: string };

export interface SendPaymentInput {
  recipient: TrustedRecipient;
  amountPaise: number;
  note?: string;
  idempotencyKey?: string;
}

export interface CreateRequestInput {
  targetName: string;
  targetHandle?: string;
  targetKind: "parent" | "teen";
  amountPaise: number;
  note?: string;
}

export interface AllowanceInput {
  amountPaise: number;
  note?: string;
  idempotencyKey?: string;
}

export interface SpaceMoveActionInput {
  fromSpace: LedgerSpace;
  toSpace: LedgerSpace;
  amountPaise: number;
  idempotencyKey?: string;
}

export interface GoalContributionActionInput {
  goalId: string;
  fromSpace: LedgerSpace;
  amountPaise: number;
  idempotencyKey?: string;
}

export interface SandboxContextValue {
  ready: boolean;
  storageIssue: StorageIssue | null;
  teen: TeenProfile;
  parent: ParentProfile;
  household: Household;
  recipients: TrustedRecipient[];
  merchants: Merchant[];
  wallet: TeenWallet;
  transactions: Transaction[];
  goals: SavingsGoal[];
  /** Newest-first. */
  requests: MoneyRequest[];
  pendingRequests: MoneyRequest[];
  /** Newest-first. */
  notifications: AppNotification[];
  unreadCount: number;
  sendPayment: (input: SendPaymentInput) => ActionResult;
  createRequest: (input: CreateRequestInput) => ActionResult<{ request: MoneyRequest }>;
  cancelRequest: (requestId: string) => ActionResult;
  fulfillRequest: (requestId: string) => ActionResult;
  sendAllowance: (input: AllowanceInput) => ActionResult;
  moveBetweenSpaces: (input: SpaceMoveActionInput) => ActionResult;
  contributeToGoal: (input: GoalContributionActionInput) => ActionResult;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  resetSandbox: () => void;
}

const SandboxContext = createContext<SandboxContextValue | null>(null);

function buildNotification(
  draft: Omit<AppNotification, "id" | "read" | "createdAt">,
  now: string,
): AppNotification {
  return { ...draft, id: uid("n"), read: false, createdAt: now };
}

/** Map engine events to notifications (moves stay quiet by design). */
function notificationsForEvent(event: LedgerEvent, now: string): AppNotification[] {
  switch (event.type) {
    case "payment_sent": {
      const firstName = event.recipientName.split(" ")[0];
      return [
        buildNotification(
          {
            kind: "money_out",
            title: `Sent ${formatINR(event.amountPaise)} to ${firstName}`,
            body: event.note ?? `Sandbox payment${event.handle ? ` to ${event.handle}` : ""}`,
            href: "/activity",
          },
          now,
        ),
      ];
    }
    case "allowance_received":
      return [
        buildNotification(
          {
            kind: "money_in",
            title: `Received ${formatINR(event.amountPaise)}`,
            body: event.requestId
              ? `Pocket money from ${event.parentName} · request paid`
              : `Pocket money from ${event.parentName}`,
            href: "/activity",
          },
          now,
        ),
      ];
    case "space_moved":
    case "goal_funded":
      return [];
  }
}

export interface SandboxProviderProps {
  children: ReactNode;
  /** Inject state directly (tests) — skips storage load. */
  initialState?: SandboxState;
  /** Override storage (tests) — defaults to browser localStorage. */
  storage?: StorageLike;
}

export function SandboxProvider({ children, initialState, storage }: SandboxProviderProps) {
  const [state, setState] = useState<SandboxState>(
    () => initialState ?? createSeedState(new Date()),
  );
  const [ready, setReady] = useState(initialState !== undefined);
  const [storageIssue, setStorageIssue] = useState<StorageIssue | null>(null);
  const stateRef = useRef(state);

  // Hydrate from storage after mount so the server render stays
  // deterministic and mismatch-free (same pattern as ThemeProvider).
  useEffect(() => {
    if (initialState !== undefined) return;
    const { state: persisted, issue } = loadPersistedState(storage);
    if (persisted) {
      stateRef.current = persisted;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(persisted);
    }
    setStorageIssue(issue);
    setReady(true);
  }, [initialState, storage]);

  const commit = useCallback(
    (updater: (prev: SandboxState) => SandboxState) => {
      const next: SandboxState = {
        ...updater(stateRef.current),
        updatedAt: new Date().toISOString(),
      };
      stateRef.current = next;
      setState(next);
      setStorageIssue(savePersistedState(next, storage) ? null : "unavailable");
    },
    [storage],
  );

  const applyOutcome = useCallback(
    (outcome: PostOutcome, now: string): ActionResult => {
      if (!outcome.ok) return { ok: false, error: outcome.error.message };
      if (!outcome.replayed) {
        const notifications = outcome.events.flatMap((event) =>
          notificationsForEvent(event, now),
        );
        commit((prev) => ({
          ...prev,
          entries: [...prev.entries, ...outcome.entries],
          notifications: [...prev.notifications, ...notifications],
        }));
      }
      return { ok: true };
    },
    [commit],
  );

  const sendPayment = useCallback(
    (input: SendPaymentInput): ActionResult => {
      const prev = stateRef.current;
      if (!input.recipient.parentApproved) {
        return {
          ok: false,
          error: `${input.recipient.name} needs parent approval before you can pay them.`,
        };
      }
      const outcome = postPayment(prev.entries, {
        walletId: prev.walletId,
        recipientName: input.recipient.name,
        recipientId: input.recipient.id,
        recipientKind: input.recipient.kind,
        handle: input.recipient.handle,
        amountPaise: input.amountPaise,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? newOperationKey(),
        now: new Date().toISOString(),
      });
      return applyOutcome(outcome, new Date().toISOString());
    },
    [applyOutcome],
  );

  const createRequest = useCallback(
    (input: CreateRequestInput): ActionResult<{ request: MoneyRequest }> => {
      const amount = validateTransferPaise(input.amountPaise);
      if (!amount.ok) return { ok: false, error: amount.error };
      const now = new Date().toISOString();
      const request: MoneyRequest = {
        id: uid("req"),
        requesterId: stateRef.current.teenId,
        targetName: input.targetName,
        targetHandle: input.targetHandle,
        targetKind: input.targetKind,
        amountPaise: amount.paise,
        note: input.note?.trim() ? input.note.trim() : undefined,
        status: "pending",
        createdAt: now,
      };
      const notification = buildNotification(
        {
          kind: "request_created",
          title: `Requested ${formatINR(request.amountPaise)}`,
          body: `From ${request.targetName}${request.note ? ` · ${request.note}` : ""}`,
          href: "/activity",
        },
        now,
      );
      commit((prev) => ({
        ...prev,
        requests: [...prev.requests, request],
        notifications: [...prev.notifications, notification],
      }));
      return { ok: true, request };
    },
    [commit],
  );

  const cancelRequest = useCallback(
    (requestId: string): ActionResult => {
      const prev = stateRef.current;
      const request = prev.requests.find((r) => r.id === requestId);
      if (!request || request.status !== "pending") {
        return { ok: false, error: "This request is no longer pending." };
      }
      const now = new Date().toISOString();
      commit((prevState) => ({
        ...prevState,
        requests: prevState.requests.map((r) =>
          r.id === requestId ? { ...r, status: "cancelled" as const, decidedAt: now } : r,
        ),
      }));
      return { ok: true };
    },
    [commit],
  );

  const fulfillRequest = useCallback(
    (requestId: string): ActionResult => {
      const prev = stateRef.current;
      const request = prev.requests.find((r) => r.id === requestId);
      if (!request || request.status !== "pending") {
        return { ok: false, error: "This request is no longer pending." };
      }
      const now = new Date().toISOString();
      const parentName = mockHousehold.parents[0]?.displayName ?? "Parent";
      const outcome = postAllowance(prev.entries, {
        walletId: prev.walletId,
        parentName,
        amountPaise: request.amountPaise,
        note: request.note,
        requestId: request.id,
        idempotencyKey: newOperationKey(),
        now,
      });
      if (!outcome.ok) return { ok: false, error: outcome.error.message };
      const paidEntryId = outcome.entries[0]?.id;
      const notifications = outcome.events.flatMap((event) =>
        notificationsForEvent(event, now),
      );
      commit((prevState) => ({
        ...prevState,
        entries: [...prevState.entries, ...outcome.entries],
        requests: prevState.requests.map((r) =>
          r.id === requestId
            ? { ...r, status: "paid" as const, decidedAt: now, paidEntryId }
            : r,
        ),
        notifications: [...prevState.notifications, ...notifications],
      }));
      return { ok: true };
    },
    [commit],
  );

  const sendAllowance = useCallback(
    (input: AllowanceInput): ActionResult => {
      const prev = stateRef.current;
      const now = new Date().toISOString();
      const parentName = mockHousehold.parents[0]?.displayName ?? "Parent";
      const outcome = postAllowance(prev.entries, {
        walletId: prev.walletId,
        parentName,
        amountPaise: input.amountPaise,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? newOperationKey(),
        now,
      });
      return applyOutcome(outcome, now);
    },
    [applyOutcome],
  );

  const moveBetweenSpaces = useCallback(
    (input: SpaceMoveActionInput): ActionResult => {
      const prev = stateRef.current;
      const outcome = postSpaceMove(prev.entries, {
        walletId: prev.walletId,
        fromSpace: input.fromSpace,
        toSpace: input.toSpace,
        amountPaise: input.amountPaise,
        idempotencyKey: input.idempotencyKey ?? newOperationKey(),
        now: new Date().toISOString(),
      });
      if (!outcome.ok) return { ok: false, error: outcome.error.message };
      if (!outcome.replayed) {
        commit((prevState) => ({
          ...prevState,
          entries: [...prevState.entries, ...outcome.entries],
        }));
      }
      return { ok: true };
    },
    [commit],
  );

  const contributeToGoal = useCallback(
    (input: GoalContributionActionInput): ActionResult => {
      const prev = stateRef.current;
      const blueprint = goalBlueprints.find((g) => g.id === input.goalId);
      if (!blueprint) {
        return { ok: false, error: "This goal no longer exists." };
      }
      const now = new Date().toISOString();
      const outcome = postGoalContribution(prev.entries, {
        walletId: prev.walletId,
        goalId: blueprint.id,
        goalName: blueprint.name,
        fromSpace: input.fromSpace,
        amountPaise: input.amountPaise,
        idempotencyKey: input.idempotencyKey ?? newOperationKey(),
        now,
      });
      if (!outcome.ok) return { ok: false, error: outcome.error.message };
      if (!outcome.replayed) {
        const wasComplete = isGoalComplete(
          deriveGoals(prev.entries, [blueprint])[0],
        );
        const nextEntries = [...prev.entries, ...outcome.entries];
        const isComplete = isGoalComplete(deriveGoals(nextEntries, [blueprint])[0]);
        const milestone =
          !wasComplete && isComplete
            ? [
                buildNotification(
                  {
                    kind: "goal_milestone" as const,
                    title: "Goal reached",
                    body: `${blueprint.name} · ${formatINR(blueprint.targetPaise)} saved`,
                    href: "/money",
                  },
                  now,
                ),
              ]
            : [];
        commit((prevState) => ({
          ...prevState,
          entries: [...prevState.entries, ...outcome.entries],
          notifications: [...prevState.notifications, ...milestone],
        }));
      }
      return { ok: true };
    },
    [commit],
  );

  const markNotificationRead = useCallback(
    (id: string) => {
      commit((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        ),
      }));
    },
    [commit],
  );

  const markAllNotificationsRead = useCallback(() => {
    commit((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => ({ ...n, read: true })),
    }));
  }, [commit]);

  const resetSandbox = useCallback(() => {
    clearPersistedState(storage);
    const fresh = createSeedState(new Date());
    stateRef.current = fresh;
    setState(fresh);
    setStorageIssue(null);
    setReady(true);
  }, [storage]);

  const wallet = useMemo(
    () => deriveWallet(state.entries, state.requests, { teenId: state.teenId }),
    [state],
  );
  const transactions = useMemo(
    () => projectTransactions(state.entries, state.requests),
    [state],
  );
  const goals = useMemo(() => deriveGoals(state.entries, goalBlueprints), [state]);
  const requests = useMemo(
    () =>
      [...state.requests]
        .map((request, index) => ({ request, index }))
        .sort(
          (a, b) =>
            b.request.createdAt.localeCompare(a.request.createdAt) || b.index - a.index,
        )
        .map(({ request }) => request),
    [state],
  );
  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === "pending"),
    [requests],
  );
  const notifications = useMemo(
    () =>
      [...state.notifications]
        .map((notification, index) => ({ notification, index }))
        .sort(
          (a, b) =>
            b.notification.createdAt.localeCompare(a.notification.createdAt) ||
            b.index - a.index,
        )
        .map(({ notification }) => notification),
    [state],
  );
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const value = useMemo<SandboxContextValue>(
    () => ({
      ready,
      storageIssue,
      teen: mockTeen,
      parent: mockHousehold.parents[0],
      household: mockHousehold,
      recipients: mockRecipients,
      merchants: mockMerchants,
      wallet,
      transactions,
      goals,
      requests,
      pendingRequests,
      notifications,
      unreadCount,
      sendPayment,
      createRequest,
      cancelRequest,
      fulfillRequest,
      sendAllowance,
      moveBetweenSpaces,
      contributeToGoal,
      markNotificationRead,
      markAllNotificationsRead,
      resetSandbox,
    }),
    [
      ready,
      storageIssue,
      wallet,
      transactions,
      goals,
      requests,
      pendingRequests,
      notifications,
      unreadCount,
      sendPayment,
      createRequest,
      cancelRequest,
      fulfillRequest,
      sendAllowance,
      moveBetweenSpaces,
      contributeToGoal,
      markNotificationRead,
      markAllNotificationsRead,
      resetSandbox,
    ],
  );

  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

export function useSandbox(): SandboxContextValue {
  const ctx = useContext(SandboxContext);
  if (!ctx) throw new Error("useSandbox must be used inside <SandboxProvider>");
  return ctx;
}
