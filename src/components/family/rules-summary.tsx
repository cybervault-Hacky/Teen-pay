"use client";

import {
  Bell,
  Gauge,
  ReceiptText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { formatINR } from "@/lib/currency";
import { summarizeGuardianNotifications } from "@/sandbox/events";
import { selectControls, selectSpendingStatus } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

function RuleRow({
  icon: Icon,
  title,
  value,
  children,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3.5 px-4 py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-muted">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-faint">{title}</p>
        <p className="mt-0.5 text-sm font-medium text-ink">{value}</p>
        {children}
      </div>
    </li>
  );
}

interface RulesSummaryProps {
  teenId: string;
  /** Wording: "you" for the teen, the teen's name for the guardian. */
  perspective: "teen" | "guardian";
}

/**
 * Every rule that applies to the teen's money, in plain words.
 * The teen and the guardian see the same list — there are no
 * hidden restrictions.
 */
export function RulesSummary({ teenId, perspective }: RulesSummaryProps) {
  const { state } = useSandbox();
  const now = new Date().toISOString();
  // Pocket money has its own section (a schedule, not a rule).
  const controls = selectControls(state, teenId);
  const status = selectSpendingStatus(state, teenId, now);
  const guardianName = status.guardian?.displayName ?? "your guardian";

  if (!controls) return null;

  const daily = status.dailyLimit;
  const spentPercent = daily ? (status.todaySpent / daily) * 100 : 0;

  return (
    <Card>
      <ul className="divide-y divide-line">
        <RuleRow
          icon={Gauge}
          title="Daily spending limit"
          value={daily === null ? "No daily limit" : `${formatINR(daily)} a day`}
        >
          {daily !== null && (
            <>
              <Progress
                value={spentPercent}
                label="Spent today against the daily limit"
                className="mt-2.5"
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                {formatINR(status.todaySpent)} spent today ·{" "}
                <span className="text-ink">
                  {formatINR(status.remainingToday ?? 0)} left
                </span>
              </p>
            </>
          )}
        </RuleRow>
        <RuleRow
          icon={ReceiptText}
          title="Per-payment limit"
          value={
            status.perTransactionLimit === null
              ? "No per-payment limit"
              : `Up to ${formatINR(status.perTransactionLimit)} per payment`
          }
        />
        <RuleRow
          icon={ShieldCheck}
          title="Approvals"
          value={
            status.approvalThreshold === null
              ? "No approvals needed"
              : perspective === "teen"
                ? `Payments above ${formatINR(status.approvalThreshold)} need ${guardianName}'s approval`
                : `You approve payments above ${formatINR(status.approvalThreshold)}`
          }
        />
        <RuleRow
          icon={Bell}
          title={perspective === "teen" ? `${guardianName} is notified about` : "You're notified about"}
          value={
            summarizeGuardianNotifications(controls.notifications).replace(
              /^./,
              (c) => c.toUpperCase(),
            )
          }
        />
      </ul>
    </Card>
  );
}
