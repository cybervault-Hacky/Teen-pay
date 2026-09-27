"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive, ArrowLeft, CornerUpLeft, History, Pencil, Plus, SearchX } from "lucide-react";
import { SPACE_TYPE_LABELS } from "@/domain";
import { formatINR } from "@/lib/currency";
import { formatDayLabel, formatFullDateTime } from "@/lib/format";
import { entryIcon } from "@/lib/transaction-icons";
import {
  getSpace,
  listSpaceEntries,
  selectAvailableBalance,
  selectTeenWallet,
  toTransaction,
} from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { TransactionDetail } from "@/components/activity/transaction-detail";
import { AmountDisplay } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { TransactionRow } from "@/components/ui/transaction-row";
import { BalanceAnnouncer } from "@/components/wallet/balance-announcer";
import { ArchiveSpaceSheet } from "./archive-space-sheet";
import { SpaceFormSheet } from "./space-form-sheet";
import { SpaceMoveSheet, type MoveDirection } from "./space-move-sheet";
import { DeadlineLine, SpaceIconTile, SpaceProgressBlock } from "./space-parts";

/**
 * One Money Space: balance, target and progress, target date, what
 * went in and out, and its real movements from the ledger — with
 * Add, Move back, Edit and Archive. Only the Space's owner can open
 * it; any other id (someone else's Space, a stale link) shows the
 * same "not available" state, revealing nothing.
 */
export function SpaceDetail({ spaceId }: { spaceId: string }) {
  const { state } = useSandbox();
  const [move, setMove] = useState<MoveDirection | null>(null);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const space = getSpace(state, spaceId);
  const wallet = selectTeenWallet(state);
  const available = selectAvailableBalance(state);

  if (!space) {
    return (
      <div>
        <BackLink />
        <Card>
          <EmptyState
            icon={SearchX}
            title="This space isn't available"
            description="It may belong to another account, or the link is out of date."
            action={
              <Button href="/money" variant="secondary" size="sm">
                Go to Money
              </Button>
            }
            className="py-10"
          />
        </Card>
      </div>
    );
  }

  const archived = space.status === "archived";
  const locked = !wallet || wallet.status !== "active";
  const goalFull = space.type === "goal" && space.progress.reached;
  const rows = listSpaceEntries(state, space.id).map((entry) => ({
    entry,
    transaction: toTransaction(state, entry),
  }));

  return (
    <div>
      <BackLink />
      <header className="mb-6 flex items-center gap-4">
        <SpaceIconTile icon={space.icon} size="lg" muted={archived} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-semibold tracking-tight text-ink">{space.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{SPACE_TYPE_LABELS[space.type]}</Badge>
            {space.isDefault && <Badge tone="neutral">Default</Badge>}
            {archived && <Badge tone="warning">Archived</Badge>}
          </div>
        </div>
      </header>

      <div className="space-y-6">
        <Card className="relative overflow-hidden p-5 sm:p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-24 h-48 w-48 rounded-full bg-accent/10 blur-3xl"
          />
          <div className="relative">
            <BalanceAnnouncer amount={space.balance} label={`${space.name} balance`} />
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              In this space
            </p>
            <AmountDisplay value={space.balance} size="display" className="mt-3" />
            <SpaceProgressBlock space={space} />
            {space.progress.target === undefined && (
              <p className="mt-2.5 text-sm text-ink-muted">No target — money here is simply set aside.</p>
            )}
            {space.deadlineInfo && <DeadlineLine space={space} className="mt-3" />}
            {archived && (
              <p className="mt-3 text-sm text-ink-muted">
                Archived{space.archivedAt ? ` on ${formatFullDateTime(space.archivedAt)}` : ""}. Its
                history stays here and in Activity.
              </p>
            )}
          </div>
        </Card>

        {!archived && (
          <section aria-label="Space actions">
            {locked && (
              <p className="mb-3 text-sm text-ink-muted">
                Your wallet is frozen, so money can&apos;t move in or out of spaces. Balances and
                history stay visible.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Button onClick={() => setMove("add")} disabled={locked || goalFull}>
                <Plus className="h-4 w-4" aria-hidden />
                Add money
              </Button>
              <Button
                variant="secondary"
                onClick={() => setMove("withdraw")}
                disabled={locked || space.balance === 0}
              >
                <CornerUpLeft className="h-4 w-4" aria-hidden />
                Move back
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
              {!space.isDefault && (
                <Button variant="ghost" onClick={() => setArchiving(true)}>
                  <Archive className="h-4 w-4" aria-hidden />
                  Archive
                </Button>
              )}
            </div>
            {goalFull && !locked && (
              <p className="mt-3 text-sm text-ink-muted">
                This goal has reached its target. Raise the target to keep adding.
              </p>
            )}
          </section>
        )}

        <p role="status" aria-live="polite" className={notice ? "text-sm text-success" : "sr-only"}>
          {notice}
        </p>

        <section aria-label="Space summary">
          <SectionHeader title="Summary" />
          <Card>
            <dl className="grid grid-cols-2 divide-x divide-line">
              <div className="p-4">
                <dt className="text-xs text-ink-faint">Total added</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-ink">
                  {formatINR(space.contributed)}
                </dd>
              </div>
              <div className="p-4">
                <dt className="text-xs text-ink-faint">Moved back</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-ink">
                  {formatINR(space.withdrawn)}
                </dd>
              </div>
            </dl>
          </Card>
        </section>

        <section aria-label="Space activity">
          <SectionHeader title="Activity" href="/activity" linkLabel="All activity" />
          <Card>
            {rows.length === 0 ? (
              <EmptyState
                icon={History}
                title="No money has moved yet"
                description="Money you add or move back will show up here."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-line">
                {rows.map(({ entry, transaction }) => (
                  <TransactionRow
                    key={entry.id}
                    transaction={{ ...transaction, when: formatDayLabel(entry.createdAt) }}
                    icon={entryIcon(entry)}
                    onSelect={() => setSelected(entry.id)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      <SpaceMoveSheet
        space={move ? space : null}
        direction={move ?? "add"}
        available={available}
        onClose={() => setMove(null)}
        onDone={setNotice}
      />
      <SpaceFormSheet
        open={editing}
        onClose={() => setEditing(false)}
        space={space}
        available={available}
        onSaved={(_, summary) => setNotice(summary)}
      />
      <ArchiveSpaceSheet
        space={archiving ? space : null}
        frozen={locked}
        onClose={() => setArchiving(false)}
        onDone={setNotice}
      />
      <TransactionDetail entryId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/money"
      className="mb-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Money
    </Link>
  );
}
