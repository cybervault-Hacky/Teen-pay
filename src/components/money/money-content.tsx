"use client";

import { useState } from "react";
import { ArrowDownLeft, ChevronDown, History, Inbox, PiggyBank, QrCode, ScanLine, Send, Star, Target } from "lucide-react";
import { formatDayLabel } from "@/lib/format";
import { entryIcon } from "@/lib/transaction-icons";
import {
  selectActiveSpaces,
  selectArchivedSpaces,
  selectMoneySummary,
  selectPendingPeerRequests,
  selectRecentSpaceMoves,
  selectTeenWallet,
  type SpaceView,
} from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { TransactionDetail } from "@/components/activity/transaction-detail";
import { AmountDisplay } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { TransactionRow } from "@/components/ui/transaction-row";
import { WalletCard } from "@/components/wallet/wallet-card";
import { SpaceCard } from "@/components/spaces/space-card";
import { SpaceFormSheet } from "@/components/spaces/space-form-sheet";
import { SpaceMoveSheet, type MoveDirection } from "@/components/spaces/space-move-sheet";
import { SpacesInfoButton } from "./spaces-info";
import { FavouritesList } from "@/components/contacts/favourites-list";

/**
 * The Money screen, in order of what matters:
 *   1. available money (the wallet) and how the total splits
 *   2. send / request money to other TeenPay teens (from available),
 *      then the fast ways in: Scan & Pay, My QR
 *   3. favourites (a few, one tap to pay or request)
 *   4. Money Spaces (Save, goals, custom)
 *   5. recent Space activity
 *   6. actions (create a goal or a space)
 * Every figure is derived from the ledger through selectors; every
 * move goes through the store into the one ledger write path.
 * `banner` (optional) is shown under the header — e.g. a learning
 * note; it changes nothing on the screen.
 */
export function MoneyContent({ banner }: { banner?: React.ReactNode } = {}) {
  const { state, contacts } = useSandbox();
  // Only the id is kept, so the sheet always sees the live Space.
  const [move, setMove] = useState<{ spaceId: string; direction: MoveDirection } | null>(null);
  const [creating, setCreating] = useState<"goal" | "custom" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const wallet = selectTeenWallet(state);
  const summary = selectMoneySummary(state);
  const active = selectActiveSpaces(state);
  const archived = selectArchivedSpaces(state);
  const recent = selectRecentSpaceMoves(state, 5);
  const openRequests = selectPendingPeerRequests(state).length;
  const locked = !wallet || wallet.status !== "active";
  const moving: SpaceView | null = move ? (active.find((s) => s.id === move.spaceId) ?? null) : null;

  return (
    <div>
      <PageHeader
        title="Your money"
        description="Every number here is derived from the sandbox ledger."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      {banner}

      <div className="space-y-6">
        {wallet && (
          <section aria-label="Wallet">
            <WalletCard wallet={wallet} title="Your wallet" />
          </section>
        )}

        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              How your money splits
            </p>
            <SpacesInfoButton />
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            <div>
              <dt className="text-xs text-ink-muted">Available</dt>
              <dd className="mt-1">
                <AmountDisplay value={summary.available} size="sm" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">In spaces</dt>
              <dd className="mt-1">
                <AmountDisplay value={summary.allocated} size="sm" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Total</dt>
              <dd className="mt-1">
                <AmountDisplay value={summary.total} size="sm" />
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            Only available money can be spent or sent. Money in spaces is still yours — move it
            back any time.
          </p>
        </Card>

        <p role="status" aria-live="polite" className={notice ? "text-sm text-success" : "sr-only"}>
          {notice}
        </p>

        <section aria-label="Send and request">
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" href="/send">
              <Send className="h-4 w-4" aria-hidden />
              Send
            </Button>
            <Button variant="secondary" href="/request">
              <ArrowDownLeft className="h-4 w-4" aria-hidden />
              Request
            </Button>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <Button variant="secondary" size="sm" href="/qr/scan">
              <ScanLine className="h-4 w-4" aria-hidden />
              Scan &amp; Pay
            </Button>
            <Button variant="secondary" size="sm" href="/qr">
              <QrCode className="h-4 w-4" aria-hidden />
              My QR
            </Button>
          </div>
          <Button variant="ghost" size="sm" href="/requests" className="mt-2 w-full">
            <Inbox className="h-4 w-4" aria-hidden />
            {openRequests > 0 ? `Requests · ${openRequests} open` : "Requests"}
          </Button>
        </section>

        <section aria-label="Favourites">
          <SectionHeader title="Favourites" href="/contacts" linkLabel={contacts.list.length > 0 ? "Manage" : "Add"} />
          {contacts.list.length > 0 ? (
            <Card>
              <FavouritesList contacts={contacts.list.slice(0, 3)} />
            </Card>
          ) : (
            <p className="flex items-center gap-2 px-1 text-sm text-ink-muted">
              <Star className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              Save people you pay often for one-tap Pay and Request.
            </p>
          )}
        </section>

        <section aria-label="Money Spaces">
          <SectionHeader title="Money Spaces" />
          {active.length === 0 ? (
            <Card>
              <EmptyState
                icon={PiggyBank}
                title="No spaces yet"
                description="Create a goal or a space to set money aside."
                className="py-10"
              />
            </Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {active.map((space) => (
                <li key={space.id}>
                  <SpaceCard
                    space={space}
                    locked={locked}
                    onAdd={() => setMove({ spaceId: space.id, direction: "add" })}
                    onWithdraw={() => setMove({ spaceId: space.id, direction: "withdraw" })}
                  />
                </li>
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                aria-expanded={showArchived}
                aria-controls="archived-spaces"
                onClick={() => setShowArchived((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${showArchived ? "rotate-180" : ""}`}
                  aria-hidden
                />
                Archived ({archived.length})
              </button>
              {showArchived && (
                <ul id="archived-spaces" className="mt-3 grid gap-3 sm:grid-cols-2">
                  {archived.map((space) => (
                    <li key={space.id}>
                      <SpaceCard space={space} locked onAdd={() => {}} onWithdraw={() => {}} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section aria-label="Recent space activity">
          <SectionHeader title="Recent space activity" href="/activity" linkLabel="View all" />
          <Card>
            {recent.length === 0 ? (
              <EmptyState
                icon={History}
                title="No space activity yet"
                description="Money you add to or move back from a space shows up here."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-line">
                {recent.map(({ entry, transaction }) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={{ ...transaction, when: formatDayLabel(entry.createdAt) }}
                    icon={entryIcon(entry)}
                    onSelect={() => setSelected(transaction.id)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section aria-label="Plan ahead">
          <SectionHeader title="Plan ahead" />
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" onClick={() => setCreating("goal")}>
              <Target className="h-4 w-4" aria-hidden />
              New goal
            </Button>
            <Button variant="secondary" onClick={() => setCreating("custom")}>
              <PiggyBank className="h-4 w-4" aria-hidden />
              New space
            </Button>
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Sandbox only — spaces are a planning tool inside your TeenPay wallet, not a bank
            account, deposit or investment. Nothing earns interest and nothing moves on its own.
          </p>
        </section>
      </div>

      <SpaceMoveSheet
        space={moving}
        direction={move?.direction ?? "add"}
        available={summary.available}
        onClose={() => setMove(null)}
        onDone={setNotice}
      />
      <SpaceFormSheet
        open={creating !== null}
        onClose={() => setCreating(null)}
        initialType={creating ?? "goal"}
        available={summary.available}
        onSaved={(_, message) => setNotice(message)}
      />
      <TransactionDetail entryId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
