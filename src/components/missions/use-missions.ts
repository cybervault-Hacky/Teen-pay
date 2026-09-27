"use client";

import type { MissionBoard, MissionView } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import type { SandboxResult } from "@/sandbox/types";

/**
 * The signed-in teen's missions. Goes through the store's read-only
 * `missionBoard` action (same signed-in gate as every action), which
 * is memoized per database snapshot and account — so re-renders don't
 * recompute, and Home, Profile and /missions share one calculation.
 * The sandbox context changes with every new snapshot, so callers
 * re-render (and get fresh progress) whenever data changes.
 */
export function useMissionBoard(): SandboxResult<MissionBoard> {
  const { actions } = useSandbox();
  return actions.missionBoard();
}

/** One mission for the signed-in teen. */
export function useMission(missionId: string): SandboxResult<MissionView> {
  const { actions } = useSandbox();
  return actions.missionDetail(missionId);
}
