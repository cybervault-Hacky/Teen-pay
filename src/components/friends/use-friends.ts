"use client";

import type { FriendCircle } from "@/domain";
import { useSandbox } from "@/sandbox/store";

/**
 * The signed-in teen's Friend Circle, from the sandbox context.
 * Null for parents — a parent never sees a teen's private circle
 * (the engine refuses the read too; this is the UI's honest view).
 * Recomputed with every new database snapshot, memoized in the
 * engine per snapshot and viewer.
 */
export function useFriendCircle(): FriendCircle | null {
  const { friendCircle } = useSandbox();
  return friendCircle;
}
