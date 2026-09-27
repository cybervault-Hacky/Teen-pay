"use client";

import { SlidersHorizontal, UserPlus } from "lucide-react";
import { useState } from "react";
import { formatUsername, type User } from "@/domain";
import { formatINR } from "@/lib/currency";
import { formatDayLabel } from "@/lib/format";
import { entryIcon } from "@/lib/transaction-icons";
import {
  listWalletEntries,
  selectAvailableBalance,
  selectControls,
  selectFlowTotals,
  selectPendingApprovals,
  selectRecentApprovalDecisions,
  selectSession,
  selectAllocatedTotal,
  selectTeensOf,
  selectTeenWallet,
  selectTotal,
  toTransaction,
} from "@/sandbox/selectors";
import { canManageSpendingRules, canViewTeenOverview } from "@/sandbox/authorization";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { SectionHeader } from "@/components/ui/section-header";
import { Switch } from "@/components/ui/switch";
import { TransactionRow } from "@/components/ui/transaction-row";
import { GuardianApprovalCard } from "@/components/family/approval-cards";
import { RulesSummary } from "@/components/family/rules-summary";
import { ParentPocketMoney } from "@/components/pocket-money/parent-pocket-money";
import { SendPocketMoney } from "./send-pocket-money";
import { SpendingRulesForm } from "./spending-rules-form";
import { FrozenBanner } from "@/components/wallet/frozen-banner";
import { WalletCard } from "@/components/wallet/wallet-card";

const decisionCopy = {
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled by teen",
} as const;

/**
 * The parent/guardian dashboard.
 *
 * Grouped into a few sections: who this is about, what needs a
 * decision, today's rules, pocket money, notifications, and the
 * shared ledger. Every action goes through the sandbox engine —
 * the same ledger and rules power the teen's screens.
 */
export function ParentContent() {
  const { state } = useSandbox();
  const session = selectSession(state);
  const teens = selectTeensOf(state, session.user.id).filter((t) =>
    canViewTeenOverview(state, session.user.id, t.id),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const teen = teens.find((t) => t.id === selectedId) ?? teens[0] ?? null;

  if (!teen) {
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

  return (
    <div>
      <p className="-mt-2 mb-6 text-xs text-ink-faint">
        Sandbox preview — no verification, no real money.
      </p>
      {teens.length > 1 && (
        <div role="group" aria-label="Choose a teen" className="mb-5 flex flex-wrap gap-2">
          {teens.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={t.id === teen.id ? "primary" : "secondary"}
              aria-pressed={t.id === teen.id}
              onClick={() => setSelectedId(t.id)}
            >
              {t.displayName}
            </Button>
          ))}
        </div>
      )}
      <TeenDashboard teen={teen} />
    </div>
  );
}

function TeenDashboard({ teen }: { teen: User }) {
  const { state, actions } = useSandbox();
  const [announcement, setAnnouncement] = useState("");
  const [sheet, setSheet] = useState<"rules" | null>(null);

  const available = selectAvailableBalance(state);
  const total = selectTotal(state);
  // The aggregate only: which Spaces, their names and goals stay
  // private to the teen (and aren't in a guardian's scope at all).
  const allocated = selectAllocatedTotal(state);
  const flows = selectFlowTotals(state);
  const controls = selectControls(state, teen.id);
  // UI hint only — the engine re-authorizes every change.
  const mayManage = canManageSpendingRules(state, selectSession(state).user.id, teen.id);
  const pending = selectPendingApprovals(state, { teenId: teen.id });
  const decided = selectRecentApprovalDecisions(state, 3).filter(
    (a) => a.teenId === teen.id,
  );

  // The teen's wallet — only in scope for their linked guardian.
  const teenWallet = selectTeenWallet(state);
  const recentEntries = teenWallet ? listWalletEntries(state, teenWallet.id).slice(0, 4) : [];

  const closeSheet = (message?: string) => {
    setSheet(null);
    if (message) setAnnouncement(message);
  };

  const toggleNotification = (key: "payments" | "savings", value: boolean) => {
    if (!controls) return;
    const result = actions.updateGuardianNotifications({
      teenId: teen.id,
      payments: key === "payments" ? value : controls.notifications.payments,
      savings: key === "savings" ? value : controls.notifications.savings,
    });
    setAnnouncement(result.ok ? "Notification settings saved." : result.error.message);
  };

  return (
    <div className="space-y-8">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Who this is about. */}
      <section aria-label="Teen overview" className="space-y-3">
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <Avatar name={teen.name} initials={teen.avatarInitials} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{teen.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                <Badge tone="neutral">Teen</Badge>
                <span>{formatUsername(teen)}</span>
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-ink-faint">Available</p>
            <AmountDisplay value={available} size="lg" />
            <p className="mt-0.5 text-xs text-ink-faint">{formatINR(total)} total</p>
          </div>
        </Card>
        {teenWallet && (
          <WalletCard wallet={teenWallet} title={`${teen.displayName}'s wallet`} showBalance={false} />
        )}
        {announcement && (
          <p className="rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-ink" aria-hidden>
            {announcement}
          </p>
        )}
      </section>

      {/* What needs a decision. */}
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
              {controls?.approval.threshold != null
                ? `${teen.displayName} will ask you before sending more than ${formatINR(controls.approval.threshold)}.`
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

      {/* Today and the rules. */}
      <section aria-label="Spending rules">
        <SectionHeader
          title="Today & rules"
          action={
            mayManage && (
            <Button variant="ghost" size="sm" onClick={() => setSheet("rules")}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Edit rules
            </Button>
            )
          }
        />
        <RulesSummary teenId={teen.id} perspective="guardian" />
      </section>

      {/* Pocket money: the recurring schedule, then a one-off send. */}
      <section aria-label="Pocket money">
        <SectionHeader title="Pocket money" />
        {teenWallet && teenWallet.status !== "active" && (
          <div className="mb-3">
            <FrozenBanner wallet={teenWallet} ownerName={`${teen.displayName}'s`} />
          </div>
        )}
        <ParentPocketMoney teen={teen} />
        <Card className="mt-3 p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Send once
          </h3>
          <SendPocketMoney
            teenName={teen.displayName}
            paused={teenWallet !== null && teenWallet.status !== "active"}
          />
        </Card>
      </section>

      {/* Notifications. */}
      {controls && (
        <section aria-label="Notification settings">
          <SectionHeader title="Notify me about" />
          <Card className="divide-y divide-line">
            <Switch
              className="px-5 py-4"
              label="Payments"
              description={`Every payment ${teen.displayName} sends.`}
              checked={controls.notifications.payments}
              onChange={(value) => toggleNotification("payments", value)}
            />
            <Switch
              className="px-5 py-4"
              label="Saving"
              description="Money moved into a Money Space (the amount only)."
              checked={controls.notifications.savings}
              onChange={(value) => toggleNotification("savings", value)}
            />
            <p className="px-5 py-3.5 text-xs text-ink-muted">
              Approval requests always reach you. {teen.displayName} can see
              these settings in Family.
            </p>
          </Card>
        </section>
      )}

      {/* The shared ledger. */}
      <section aria-label="Recent activity">
        <Card>
          <p className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Recent activity
          </p>
          <ul className="divide-y divide-line">
            {recentEntries.map((entry) => (
              <TransactionRow
                key={entry.id}
                transaction={{
                  ...toTransaction(state, entry),
                  subtitle: formatDayLabel(entry.createdAt),
                  when: formatDayLabel(entry.createdAt),
                }}
                icon={entryIcon(entry)}
              />
            ))}
          </ul>
        </Card>
      </section>

      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          Overview
        </p>
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
        <p className="mt-4 border-t border-line pt-3.5 text-xs text-ink-muted">
          Set aside in Money Spaces: {formatINR(allocated)} · the details stay private to {teen.displayName}
        </p>
      </Card>

      <p className="text-xs text-ink-faint">
        Parent and teen read the same sandbox ledger — your pocket money leaves
        your wallet and arrives in {teen.displayName}&apos;s as one linked transfer.
      </p>

      <Modal open={sheet === "rules"} onClose={() => closeSheet()} title="Spending rules">
        <SpendingRulesForm
          teenId={teen.id}
          teenName={teen.displayName}
          onSaved={(message) => closeSheet(message)}
          onCancel={() => closeSheet()}
        />
      </Modal>
    </div>
  );
}
