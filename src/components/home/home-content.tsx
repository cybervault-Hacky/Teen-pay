"use client";

import {
  listWalletEntries,
  selectActiveSpaces,
  selectAvailableBalance,
  selectMoneySummary,
  selectPendingApprovals,
  selectPendingRequests,
  selectTeen,
  selectTeenWallet,
  selectTotal,
  toTransaction,
} from "@/sandbox/selectors";
import { FrozenBanner } from "@/components/wallet/frozen-banner";
import { findUser } from "@/sandbox/identity";
import { useSandbox } from "@/sandbox/store";
import { ActivityPreview } from "./activity-preview";
import { BalanceCard } from "./balance-card";
import { HomeHeader } from "./home-header";
import { PendingRequests } from "./pending-requests";
import { PeerRequestsCard } from "./peer-requests-card";
import { QuickActions } from "./quick-actions";
import { SpacesSummary } from "./spaces-summary";
import { NextPocketMoney } from "./next-pocket-money";
import { SpendingStrip } from "./spending-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { TeenApprovalCard } from "@/components/family/approval-cards";
import { CoachHomeCard } from "@/components/coach/coach-home-card";

/**
 * The Home screen, driven entirely by derived sandbox state:
 * balance, a compact Money Spaces summary, latest transactions, pending
 * requests and approvals all come from local state — money from
 * the ledger.
 */
export function HomeContent() {
  const { state } = useSandbox();

  const teen = selectTeen(state);
  const available = selectAvailableBalance(state);
  const total = selectTotal(state);
  const spaces = selectActiveSpaces(state);
  const { allocated } = selectMoneySummary(state);
  const wallet = selectTeenWallet(state);
  const latest = (wallet ? listWalletEntries(state, wallet.id) : [])
    .slice(0, 3)
    .map((entry) => ({ entry, transaction: toTransaction(state, entry) }));
  const pending = selectPendingRequests(state);
  const approvals = selectPendingApprovals(state, { teenId: teen.id });

  return (
    <div>
      <HomeHeader user={teen} />

      <div className="space-y-6">
        <BalanceCard user={teen} available={available} total={total} />

        {wallet && wallet.status !== "active" && (
          <FrozenBanner
            wallet={wallet}
            ownerName="Your"
            frozenByName={
              wallet.statusChangedBy && wallet.statusChangedBy !== teen.id
                ? findUser(state, wallet.statusChangedBy)?.displayName
                : undefined
            }
            href="/money"
          />
        )}

        <QuickActions />

        <SpendingStrip teenId={teen.id} />

        <NextPocketMoney teenId={teen.id} />

        {approvals.length > 0 && (
          <section aria-label="Waiting for approval">
            <SectionHeader title="Waiting for approval" href="/family" linkLabel="Family" />
            <div className="space-y-2.5">
              {approvals.map((approval) => (
                <TeenApprovalCard key={approval.id} approval={approval} />
              ))}
            </div>
          </section>
        )}

        <PeerRequestsCard />

        {pending.length > 0 && (
          <PendingRequests
            items={pending.map((request) => {
              const recipient = state.recipients.find(
                (r) => r.id === request.recipientId,
              );
              return {
                name: recipient?.name ?? "Someone",
                amount: request.amount,
                note: request.note,
              };
            })}
          />
        )}

        <CoachHomeCard />

        <SpacesSummary spaces={spaces} allocated={allocated} />

        <section aria-label="Recent activity">
          <SectionHeader
            title="Recent activity"
            href="/activity"
            linkLabel="View all"
          />
          <ActivityPreview rows={latest} />
        </section>
      </div>
    </div>
  );
}
