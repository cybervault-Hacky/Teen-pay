import {
  coachWindows,
  defaultSaveSpaceId,
  deriveCoachReport,
  describePocketMoneyCadence,
  isInRange,
  type CoachDayRange,
  type CoachFacts,
  type CoachGoal,
  type CoachPeriod,
  type CoachPeriodTotals,
  type CoachReport,
  productDay,
  type LedgerEntry,
} from "@/domain";
import { scopeFor } from "./scope";
import {
  listWalletEntries,
  selectActiveSpaces,
  selectMoneySummary,
  selectNextPocketMoney,
  selectPendingApprovals,
  selectViewerWallet,
} from "./selectors";
import type { SandboxDatabase, SandboxError, SandboxResult, SandboxState } from "./types";

/**
 * Money Coach analytics (Phase 10) — read-only.
 *
 *   ledger → existing selectors → facts (here) → insights (domain) → UI
 *
 * This module only reads. It has no write path: it never calls
 * `postOperation`, a transition, `dispatch` or storage, and returns
 * plain data. Balances, Space balances and goal progress come from the
 * existing selectors (`selectMoneySummary`, `selectActiveSpaces`), so
 * there's no second calculation of them. The only thing computed here
 * is "what happened in this window", from the viewer's own wallet
 * entries (`listWalletEntries`).
 *
 * Teen-only: a guardian's scope can include the linked teen's wallet
 * (for the parent overview), so a Coach for a parent would expose the
 * teen's spending. It returns `not_permitted` for anyone but an active
 * teen looking at their own wallet.
 */

export const COACH_NOT_PERMITTED: SandboxError = {
  code: "not_permitted",
  message: "Money Coach is available on teen accounts.",
};

/** What counts, by ledger entry type — decided once, here. */
const SPENDING = new Set<LedgerEntry["type"]>(["payment_sent", "transfer_out"]);

function emptyTotals(): CoachPeriodTotals {
  return {
    spent: 0,
    spendingCount: 0,
    payments: 0,
    transfers: 0,
    refunded: 0,
    received: { pocketMoney: 0, fromPeople: 0, sandbox: 0, total: 0 },
    pocketMoneyCount: 0,
    movedToSpaces: 0,
    movedFromSpaces: 0,
  };
}

/**
 * One window's totals from the viewer's own wallet entries. Ledger
 * entries only exist for completed money movements, so pending,
 * declined, cancelled or failed payments (approvals, requests, failed
 * pocket-money runs) can never be counted here.
 *
 *  · spent     — payment_sent + transfer_out (the same types as the
 *                guardian's daily limit, `SPENDING_TYPES`);
 *  · received  — allowance_credit (pocket money), transfer_in +
 *                payment_received (from people), deposit (sandbox);
 *  · refunded  — refund credits: money back, never income and never
 *                negative spending;
 *  · Spaces    — space_allocation / space_release: money set aside or
 *                moved back, never spending or income;
 *  · reversals — sandbox corrections: neither spending nor income.
 */
export function periodTotals(entries: readonly LedgerEntry[], dayRange: CoachDayRange): CoachPeriodTotals {
  const t = emptyTotals();
  for (const e of entries) {
    if (e.status !== "completed" || !isInRange(e.createdAt, dayRange)) continue;
    if (SPENDING.has(e.type) && e.direction === "debit") {
      t.spent += e.amount;
      t.spendingCount += 1;
      if (e.type === "payment_sent") t.payments += e.amount;
      else t.transfers += e.amount;
      continue;
    }
    switch (e.type) {
      case "allowance_credit":
        t.received.pocketMoney += e.amount;
        t.pocketMoneyCount += 1;
        break;
      case "transfer_in":
      case "payment_received":
        t.received.fromPeople += e.amount;
        break;
      case "deposit":
        t.received.sandbox += e.amount;
        break;
      case "refund":
        t.refunded += e.amount;
        break;
      case "space_allocation":
        t.movedToSpaces += e.amount;
        break;
      case "space_release":
        t.movedFromSpaces += e.amount;
        break;
      default:
        break;
    }
  }
  t.received.total = t.received.pocketMoney + t.received.fromPeople + t.received.sandbox;
  return t;
}

/** The viewer's facts, or null when the viewer can't have a Coach. */
export function coachFactsFor(state: SandboxState, period: CoachPeriod, now: string): CoachFacts | null {
  const viewerId = state.session.currentUserId;
  const viewer = state.users.find((u) => u.id === viewerId);
  if (!viewer || viewer.role !== "teen") return null;
  const wallet = selectViewerWallet(state);
  // Own wallet only — never someone else's, even if it were in scope.
  if (!wallet || wallet.ownerAccountId !== viewerId) return null;

  const windows = coachWindows(period, now);
  const entries = listWalletEntries(state, wallet.id);
  const money = selectMoneySummary(state);

  const goals: CoachGoal[] = selectActiveSpaces(state, now)
    .filter((space) => space.progress.target !== undefined && space.progress.percent !== undefined)
    .map((space) => ({
      name: space.name,
      type: space.type,
      // The default Save Space's id embeds the account id, so the
      // Coach links it to the Money screen (where it's listed first)
      // rather than repeat that id; other Spaces link to their page.
      href: space.id === defaultSaveSpaceId(viewerId) ? "/money" : `/money/${encodeURIComponent(space.id)}`,
      balance: space.progress.balance,
      target: space.progress.target!,
      percent: space.progress.percent!,
      remaining: space.progress.remaining ?? 0,
      reached: space.progress.reached,
      ...(space.deadlineInfo
        ? {
            deadline: space.deadlineInfo.date,
            daysLeft: space.deadlineInfo.daysLeft,
            deadlineState: space.deadlineInfo.state,
          }
        : {}),
    }));

  const pending = selectPendingApprovals(state, { teenId: viewerId });
  const next = selectNextPocketMoney(state, viewerId);
  const canCompare = productDay(wallet.createdAt) <= windows.previous.startDay;

  return {
    period,
    windows,
    hasHistory: entries.length > 0,
    canCompare,
    available: money.available,
    setAside: money.allocated,
    total: money.total,
    current: periodTotals(entries, windows.current),
    previous: canCompare ? periodTotals(entries, windows.previous) : null,
    goals,
    pendingApprovals: {
      count: pending.length,
      amount: pending.reduce((sum, a) => sum + a.amount, 0),
    },
    nextPocketMoney: next
      ? {
          amount: next.schedule.amount,
          day: next.occurrence,
          cadence: describePocketMoneyCadence(next.schedule),
        }
      : null,
  };
}

/** A scoped state's report (pure; `now` explicit). */
export function buildCoachReport(state: SandboxState, period: CoachPeriod, now: string): CoachReport | null {
  const facts = coachFactsFor(state, period, now);
  return facts ? deriveCoachReport(facts) : null;
}

const cache = new WeakMap<SandboxDatabase, Map<string, SandboxResult<CoachReport>>>();

/**
 * The report for an account, straight from the database: scoped to
 * that account first (`scopeFor`), then analysed. Memoized per
 * database snapshot (immutable), account, period and day — so Home and
 * the Coach screen share one calculation, and nothing is recomputed
 * until money actually moves or the day changes.
 */
export function coachReportFor(
  db: SandboxDatabase,
  accountId: string,
  period: CoachPeriod,
  now: string,
): SandboxResult<CoachReport> {
  const key = `${accountId}|${period}|${productDay(now)}`;
  const byDb = cache.get(db) ?? new Map<string, SandboxResult<CoachReport>>();
  const hit = byDb.get(key);
  if (hit) return hit;
  const scope = scopeFor(db, accountId);
  const report = scope ? buildCoachReport(scope.state, period, now) : null;
  const result: SandboxResult<CoachReport> = report
    ? { ok: true, value: report }
    : { ok: false, error: { ...COACH_NOT_PERMITTED } };
  byDb.set(key, result);
  cache.set(db, byDb);
  return result;
}
