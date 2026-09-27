"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { formatINR } from "@/lib/currency";
import { useState } from "react";
import type { LedgerEntry, Transaction } from "@/domain";
import { cn } from "@/lib/cn";
import { entryIcon } from "@/lib/transaction-icons";
import { dayKey, formatDayLabel, relativeDayLabel } from "@/lib/format";
import {
  listWalletEntries,
  selectPendingApprovals,
  selectPendingPeerRequests,
  selectPendingRequests,
  selectTeen,
  selectTeenWallet,
  toTransaction,
} from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { TransactionRow } from "@/components/ui/transaction-row";
import { TeenApprovalCard } from "@/components/family/approval-cards";
import { FamilyActivity } from "@/components/family/family-activity";
import { RequestCard } from "./request-card";
import { TransactionDetail } from "./transaction-detail";

type Filter = "all" | "in" | "out";
type View = "transactions" | "family";

const views: { id: View; label: string }[] = [
  { id: "transactions", label: "Transactions" },
  { id: "family", label: "Family updates" },
];

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in", label: "Money in" },
  { id: "out", label: "Money out" },
];

interface FeedRow {
  entry: LedgerEntry;
  transaction: Transaction;
}

/**
 * The live activity feed, derived from the ledger.
 * Pending approvals and requests sit on top — they are not
 * transactions, and nothing has moved. Search and filters operate
 * on real local state. Family/approval events live in their own
 * view so they never look like money movement.
 *
 * `onOpenTransaction` (optional) is told when the teen opens a
 * transaction's details — used by a learning mission; it's a signal
 * only and changes nothing about the feed.
 */
export function ActivityFeed({ onOpenTransaction }: { onOpenTransaction?: () => void } = {}) {
  const { state } = useSandbox();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Client-only screen (behind the auth gate): "now" for Today/Yesterday.
  const [now] = useState(() => new Date().toISOString());

  const [view, setView] = useState<View>("transactions");
  const pendingRequests = selectPendingRequests(state);
  // TeenPay money requests: open, so not transactions — listed apart.
  const peerRequests = selectPendingPeerRequests(state, now);
  const pendingApprovals = selectPendingApprovals(state, {
    teenId: selectTeen(state).id,
  });

  // The teen wallet's entries → display rows, newest first. Titles,
  // signs and statuses come from the central transaction queries.
  const wallet = selectTeenWallet(state);
  const rows: FeedRow[] = (wallet ? listWalletEntries(state, wallet.id) : []).map(
    (entry) => ({ entry, transaction: toTransaction(state, entry) }),
  );

  const q = query.trim().toLowerCase();
  const visible = rows.filter(({ transaction }) => {
    const isIn = transaction.direction === "in";
    const matchesFilter =
      filter === "all" || (filter === "in" ? isIn : !isIn);
    const matchesQuery =
      q === "" ||
      `${transaction.title} ${transaction.subtitle} ${transaction.statusLabel ?? ""}`
        .toLowerCase()
        .includes(q);
    return matchesFilter && matchesQuery;
  });

  // Group visible rows by day (product timezone): Today, Yesterday,
  // then dated days — the absolute date always shown alongside.
  const groups: {
    key: string;
    label: string;
    relative: string | null;
    items: FeedRow[];
  }[] = [];
  for (const row of visible) {
    const key = dayKey(row.entry.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(row);
    } else {
      groups.push({
        key,
        label: formatDayLabel(row.entry.createdAt),
        relative: relativeDayLabel(row.entry.createdAt, now),
        items: [row],
      });
    }
  }

  const viewToggle = (
    <div
      role="group"
      aria-label="Activity view"
      className="flex w-full max-w-[300px] gap-1 rounded-full border border-line bg-surface p-1"
    >
      {views.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={view === option.id}
          onClick={() => setView(option.id)}
          className={cn(
            "flex-1 rounded-full px-3 py-1.5 text-sm font-medium",
            "transition-colors duration-150",
            view === option.id
              ? "bg-surface-2 text-ink"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  if (view === "family") {
    return (
      <div className="space-y-6">
        {viewToggle}
        <FamilyActivity limit={30} />
        <p className="text-xs text-ink-faint">
          Family updates are sandbox events on this device. Money movement
          only ever appears under Transactions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {viewToggle}

      {pendingApprovals.length > 0 && (
        <section aria-label="Waiting for approval">
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Waiting for approval
          </h3>
          <div className="space-y-2.5">
            {pendingApprovals.map((approval) => (
              <TeenApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        </section>
      )}

      {pendingRequests.length > 0 && (
        <section aria-label="Pending requests">
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Pending requests
          </h3>
          <div className="space-y-2.5">
              {pendingRequests.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))}
          </div>
        </section>
      )}

      {peerRequests.length > 0 && (
        <section aria-label="Money requests">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              Money requests
            </h3>
            <Link
              href="/requests"
              className="text-xs font-medium text-ink-faint transition-colors duration-150 hover:text-ink"
            >
              Open Requests
            </Link>
          </div>
          <Card>
            <ul className="divide-y divide-line">
              {peerRequests.map((request) => (
                <li key={request.requestId} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {request.direction === "incoming"
                        ? `${formatINR(request.amount)} requested by ${request.party.handle}`
                        : `${formatINR(request.amount)} requested from ${request.party.handle}`}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {request.awaitingApproval ? "Awaiting approval" : "Pending"} · nothing has moved
                      {request.note ? ` · ${request.note}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">{formatDayLabel(request.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 [&_input]:pl-10">
          <Input
            label="Search"
            placeholder="Search activity"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div
          role="group"
          aria-label="Filter activity"
          className="flex shrink-0 gap-1.5"
        >
          {filters.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-medium",
                "transition-colors duration-150",
                filter === option.id
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-line bg-surface text-ink-muted hover:text-ink",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Nothing matches"
            description="Try a different search, or clear the filters."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section
              key={group.key}
              aria-label={group.relative ? `${group.relative}, ${group.label}` : group.label}
            >
              <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                {group.relative ? (
                  <>
                    <span className="text-ink-muted">{group.relative}</span>{" "}
                    <span className="font-medium normal-case tracking-normal">
                      · <span>{group.label}</span>
                    </span>
                  </>
                ) : (
                  group.label
                )}
              </h3>
              <Card>
                <ul className="divide-y divide-line">
                  {group.items.map((row) => (
                    <TransactionRow
                      key={row.entry.id}
                      transaction={{
                        ...row.transaction,
                        when: formatDayLabel(row.entry.createdAt),
                      }}
                      icon={entryIcon(row.entry)}
                      onSelect={() => {
                        setSelectedId(row.entry.id);
                        onOpenTransaction?.();
                      }}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-faint">
        Sandbox activity — stored only on this device.
      </p>

      <TransactionDetail entryId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
