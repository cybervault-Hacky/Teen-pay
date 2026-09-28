"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { formatINR } from "@/lib/currency";
import { entryIcon } from "@/lib/transaction-icons";
import {
  selectParentCenter,
  type ParentCenterView,
  type TeenCenterView,
} from "@/sandbox/parent-center";
import { selectFlowTotals, selectSession } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { TransactionRow } from "@/components/ui/transaction-row";
import { GuardianApprovalCard } from "@/components/family/approval-cards";
import { ParentPocketMoney } from "@/components/pocket-money/parent-pocket-money";
import { FrozenBanner } from "@/components/wallet/frozen-banner";
import { WalletCard } from "@/components/wallet/wallet-card";
import { ParentControls } from "./parent-controls";
import { ParentFamilyCard } from "./parent-family-card";
import { SendPocketMoney } from "./send-pocket-money";

const decisionCopy = {
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled by teen",
} as const;

/**
 * The Parent Control Center — the parent-facing command surface for
 * the family's existing TeenPay relationship and controls.
 *
 * A management layer, not a second system: every figure comes from
 * the parent-safe projection (`selectParentCenter`), and every action
 * goes through the same guardian transitions, authorization and
 * ledger the teen's screens use. Priorities, top down: pending
 * approvals, controls, pocket money, family, activity. Teen-private
 * areas (Coach, Missions, Friend Circles, Safety Shield) stay out of
 * scope entirely.
 */
export function ParentContent() {
  const { state } = useSandbox();
  const session = selectSession(state);
  const center = selectParentCenter(state, session.user.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!center || center.teens.length === 0) {
    return (
      <Card>
        <EmptyState
          className="py-10"
          icon={UserPlus}
          title="No teen connected yet"
          description="Ask your teen for their invite code, then add them in Family. Family controls unlock once you're connected."
          action={
            <Button href="/family" size="sm">
              Add a teen
            </Button>
          }
        />
      </Card>
    );
  }

  const teen =
    center.teens.find((t) => t.teen.accountId === selectedId) ?? center.teens[0]!;

  return (
    <div>
      <p className="-mt-2 mb-6 text-xs text-ink-faint">
        Sandbox preview — no verification, no real money.
      </p>

      {/* Greeting + which teen this view is managing. */}
      <section aria-label="Parent overview" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Hello, {firstName(center.parent.displayName)}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {center.teens.length === 1
                ? `Everything for ${center.teens[0]!.teen.displayName}, in one calm place.`
                : "Choose which of your teens you're managing."}
            </p>
          </div>
          {center.invitePendingReview && (
            <Badge tone="warning">{center.invitePendingReview.teenName} asked to connect</Badge>
          )}
        </div>

        {center.teens.length > 1 && (
          <div role="group" aria-label="Choose a teen to manage" className="flex flex-wrap gap-2">
            {center.teens.map((t) => (
              <Button
                key={t.teen.accountId}
                size="sm"
                variant={t.teen.accountId === teen.teen.accountId ? "primary" : "secondary"}
                aria-pressed={t.teen.accountId === teen.teen.accountId}
                onClick={() => setSelectedId(t.teen.accountId)}
              >
                {t.teen.displayName} · {t.teen.handle}
              </Button>
            ))}
          </div>
        )}
      </section>

      <TeenCenter key={teen.teen.accountId} center={center} teen={teen} />
    </div>
  );
}

function firstName(displayName: string): string {
  return displayName.split(" ")[0] ?? displayName;
}

function TeenCenter({
  center,
  teen,
}: {
  center: ParentCenterView;
  teen: TeenCenterView;
}) {
  const [announcement, setAnnouncement] = useState("");
  const pending = teen.approvals.pending;
  const decided = teen.approvals.recentDecisions;
  const walletVisible = teen.family.walletVisible;

  return (
    <div className="mt-6 space-y-8">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Who this is about, and the money summary. */}
      <section aria-label="Teen overview" className="space-y-3">
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <Avatar name={teen.teen.fullName} initials={teen.teen.initials} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{teen.teen.fullName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                <Badge tone="neutral">Teen</Badge>
                <span>{teen.teen.handle}</span>
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            {teen.money ? (
              <>
                <p className="text-xs text-ink-faint">Available</p>
                <AmountDisplay value={teen.money.available} size="lg" />
                <p className="mt-0.5 text-xs text-ink-faint">
                  {formatINR(teen.money.total)} total
                </p>
              </>
            ) : (
              <p className="max-w-[240px] text-xs leading-relaxed text-ink-muted">
                Money details aren&apos;t in view for {teen.teen.displayName} in this sandbox.
              </p>
            )}
          </div>
        </Card>

        {/* The numbers that matter, at a glance. */}
        {teen.money && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatCard
              label="Total"
              value={formatINR(teen.money.total)}
              hint="Wallet + Spaces"
            />
            <StatCard
              label="Set aside"
              value={formatINR(teen.money.allocated)}
              hint="Details stay private"
            />
            <StatCard
              label="Pocket money"
              value={
                teen.allowance
                  ? `${formatINR(teen.allowance.amount)} · ${teen.allowance.cadence}`
                  : "Not set up"
              }
              small
            />
            <StatCard
              label="Pending approvals"
              value={String(pending.length)}
              hint={pending.length > 0 ? "Needs your decision" : undefined}
            />
          </div>
        )}
        {announcement && (
          <p className="rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-ink" aria-hidden>
            {announcement}
          </p>
        )}
      </section>

      {/* 1. What needs a decision. */}
      <section aria-label="Approvals">
        <SectionHeader title="Approvals" />
        {pending.length > 0 ? (
          <div className="space-y-2.5">
            {pending.map((approval) => (
              <GuardianApprovalCard
                key={approval.id}
                approval={approval}
                onDecided={setAnnouncement}
              />
            ))}
          </div>
        ) : (
          <Card className="px-5 py-4">
            <p className="text-sm text-ink-muted">
              Nothing waiting.{" "}
              {teen.controls?.approval.threshold != null
                ? `${teen.teen.displayName} will ask you before sending more than ${formatINR(
                    teen.controls.approval.threshold,
                  )}.`
                : "Turn on “Ask me first” in the rules to review bigger payments."}
            </p>
          </Card>
        )}
        {decided.length > 0 && (
          <ul className="mt-3 space-y-1.5 px-1" aria-label="Recent decisions">
            {decided.map((approval) => (
              <li key={approval.id} className="flex justify-between gap-3 text-xs text-ink-muted">
                <span className="truncate">
                  {formatINR(approval.amount)} to {approval.recipientName}
                </span>
                <span className="shrink-0">
                  {approval.status === "pending" ? "" : decisionCopy[approval.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. Controls: rules, account protection, notifications. */}
      <section aria-label="Controls" className="space-y-3">
        <SectionHeader title="Controls" />
        <ParentControls center={teen} onAnnounce={setAnnouncement} />
        <div>
          <h3 className="mb-2 px-1 text-sm font-medium text-ink">Account protection</h3>
          {walletVisible ? (
            <TeenWalletCard teen={teen} />
          ) : (
            <Card className="px-5 py-4">
              <p className="text-sm text-ink-muted">
                Account protection applies to money you can see in this view.
              </p>
            </Card>
          )}
        </div>
      </section>

      {/* 3. Pocket money: the recurring schedule, then a one-off send. */}
      <section aria-label="Pocket money">
        <SectionHeader title="Pocket money" />
        {teen.wallet && teen.wallet.status !== "active" && (
          <div className="mb-3">
            <TeenFrozenBanner teen={teen} />
          </div>
        )}
        <ParentPocketMoney
          teen={{ id: teen.teen.accountId, displayName: teen.teen.displayName }}
        />
        <Card className="mt-3 p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Send once
          </h3>
          <SendPocketMoney
            teenName={teen.teen.displayName}
            paused={teen.wallet !== null && teen.wallet.status !== "active"}
          />
        </Card>
      </section>

      {/* 4. Family status. */}
      <section aria-label="Family">
        <SectionHeader title="Family" />
        <ParentFamilyCard center={center} selectedTeenId={teen.teen.accountId} />
      </section>

      {/* 5. Activity — derived summaries, never raw entries. */}
      <section aria-label="Recent activity">
        <Card>
          <p className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Recent activity
          </p>
          {teen.activity.length > 0 ? (
            <ul className="divide-y divide-line">
              {teen.activity.map((row) => (
                <TransactionRow
                  key={row.id}
                  transaction={row}
                  icon={entryIcon({ type: row.entryType })}
                />
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-4 pt-1 text-sm text-ink-muted">Nothing to show yet.</p>
          )}
        </Card>
      </section>

      <MoneySummaryCard teen={teen} />

      <p className="text-xs leading-relaxed text-ink-faint">
        Money Coach, Missions, Friend Circles and the Safety Shield stay private to{" "}
        {teen.teen.displayName}. You see the money you&apos;re connected to and the rules you
        set — nothing more.
      </p>
    </div>
  );
}

/** The teen's wallet card, rendered only when the wallet is in scope. */
function TeenWalletCard({ teen }: { teen: TeenCenterView }) {
  const wallet = useTeenWallet(teen);
  if (!wallet) return null;
  return (
    <WalletCard wallet={wallet} title={`${teen.teen.displayName}'s wallet`} showBalance={false} />
  );
}

/** The freeze notice, rendered only when the wallet is in scope. */
function TeenFrozenBanner({ teen }: { teen: TeenCenterView }) {
  const wallet = useTeenWallet(teen);
  if (!wallet) return null;
  return <FrozenBanner wallet={wallet} ownerName={`${teen.teen.displayName}'s`} />;
}

/** The scoped wallet behind a projection id — null when out of scope. */
function useTeenWallet(teen: TeenCenterView) {
  const { state } = useSandbox();
  return state.wallets.find((w) => w.id === teen.wallet?.walletId) ?? null;
}

function StatCard({
  label,
  value,
  hint,
  small,
}: {
  label: string;
  value: string;
  hint?: string;
  small?: boolean;
}) {
  return (
    <Card className="p-3.5">
      <p className="text-[11px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-semibold tracking-tight text-ink ${small ? "text-sm" : "text-lg"}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>}
    </Card>
  );
}

function MoneySummaryCard({ teen }: { teen: TeenCenterView }) {
  const { state } = useSandbox();
  const flows = teen.family.walletVisible ? selectFlowTotals(state) : null;
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Overview</p>
      {flows ? (
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-ink-faint">Money in</p>
            <AmountDisplay value={flows.moneyIn} size="md" className="mt-1" tone="success" />
          </div>
          <div>
            <p className="text-xs text-ink-faint">Money out</p>
            <AmountDisplay value={flows.moneyOut} size="md" className="mt-1" />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">
          Money summaries appear once this teen&apos;s wallet is in view.
        </p>
      )}
      {teen.money && (
        <p className="mt-4 border-t border-line pt-3.5 text-xs text-ink-muted">
          In Money Spaces: {formatINR(teen.money.allocated)} · the details stay private to{" "}
          {teen.teen.displayName}
        </p>
      )}
    </Card>
  );
}
