"use client";

import type { CoachPeriod, CoachReport } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import type { SandboxResult } from "@/sandbox/types";

/**
 * The signed-in teen's Money Coach report for a period.
 *
 * Read-only: it goes through the store's `coachReport` action (same
 * signed-in gate as every action), which is memoized per database
 * snapshot, period and day — so re-rendering never re-scans the
 * ledger, and Home and /coach share one calculation. The sandbox
 * context changes with every new database snapshot, so the caller
 * re-renders (and gets a fresh report) whenever money moves.
 */
export function useCoachReport(period: CoachPeriod): SandboxResult<CoachReport> {
  const { actions } = useSandbox();
  return actions.coachReport(period);
}
