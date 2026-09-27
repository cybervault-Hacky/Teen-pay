"use client";

import Link from "next/link";
import { selectIncomingRequests, selectOutgoingRequests } from "@/sandbox/selectors";
import { formatINR } from "@/lib/currency";
import { useSandbox } from "@/sandbox/store";
import { Card } from "@/components/ui/card";

/**
 * Home's quiet pointer to the Requests center: the first request
 * someone sent you (or, failing that, your open requests). Hidden
 * when there's nothing open. Money moves only from the center.
 */
export function PeerRequestsCard() {
  const { state } = useSandbox();
  const now = new Date().toISOString();
  const incoming = selectIncomingRequests(state, now);
  const outgoing = selectOutgoingRequests(state, now);
  if (incoming.length === 0 && outgoing.length === 0) return null;
  const first = incoming[0];

  return (
    <section aria-label="Money requests">
      <Card className="p-4">
        <Link
          href="/requests"
          className="flex items-center justify-between gap-3 transition-opacity duration-150 hover:opacity-80"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              {first
                ? `${formatINR(first.amount)} requested by ${first.party.handle}`
                : `${outgoing.length} open request${outgoing.length === 1 ? "" : "s"} you sent`}
            </span>
            <span className="mt-0.5 block truncate text-xs text-ink-muted">
              {first
                ? [
                    first.note,
                    incoming.length > 1 ? `+${incoming.length - 1} more to answer` : null,
                    outgoing.length > 0 ? `${outgoing.length} sent` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Pay or decline in Requests"
                : "Waiting for them to pay"}
            </span>
          </span>
          <span className="shrink-0 text-xs font-medium text-ink-muted">View</span>
        </Link>
      </Card>
    </section>
  );
}
