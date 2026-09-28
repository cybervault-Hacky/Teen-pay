"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { useFriendCircle } from "./use-friends";

/**
 * Home: a compact pointer to the Friend Circle — how many trusted
 * friends there are, or how many requests are waiting. Calm and
 * factual: no invitations, no pressure, no engagement mechanics.
 * Teens only (null circle → nothing renders).
 */
export function FriendsHomeCard() {
  const circle = useFriendCircle();
  if (!circle) return null;

  const waiting = circle.incoming.length;
  const subtitle =
    waiting > 0
      ? `${waiting === 1 ? "1 request" : `${waiting} requests`} waiting`
      : circle.friends.length === 1
        ? "1 trusted friend"
        : `${circle.friends.length} trusted friends`;

  return (
    <section aria-label="Friend Circle">
      <SectionHeader title="Friend Circle" href="/friends" linkLabel="Open" />
      <Link
        href="/friends"
        className="block rounded-2xl transition-opacity duration-150 hover:opacity-90 motion-reduce:transition-none"
      >
        <Card className="flex items-center gap-3.5 p-4 sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-muted">
            <Users className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">Your Circle</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {circle.friends.length === 0 && waiting === 0
                ? "Add someone you know by their TeenPay ID"
                : subtitle}
            </span>
          </span>
        </Card>
      </Link>
    </section>
  );
}
