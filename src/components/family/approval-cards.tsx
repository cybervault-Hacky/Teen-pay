"use client";

import { Clock, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import type { ApprovalRequest } from "@/domain";
import { formatINR } from "@/lib/currency";
import { formatDateTime, initialsOf } from "@/lib/format";
import { findUser } from "@/sandbox/identity";
import { canApprovePayment } from "@/sandbox/authorization";
import { selectSession, selectSpendingStatus } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface GuardianApprovalCardProps {
  approval: ApprovalRequest;
  /** Reports the outcome so the page can announce it. */
  onDecided?: (message: string) => void;
}

/**
 * The guardian's decision card. Approve executes the payment
 * through the ledger exactly once; decline moves nothing. A
 * synchronous guard plus the engine's idempotency make double
 * clicks harmless.
 */
export function GuardianApprovalCard({ approval, onDecided }: GuardianApprovalCardProps) {
  const { state, actions } = useSandbox();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const teen = findUser(state, approval.teenId);
  const teenName = teen?.displayName ?? "Your teen";
  const status = selectSpendingStatus(state, approval.teenId);
  const amountLabel = `${formatINR(approval.amount)} to ${approval.recipientName}`;
  // UI hint only — the engine re-authorizes every decision.
  const mayDecide = canApprovePayment(state, selectSession(state).user.id, approval);

  const decide = (decision: "approve" | "decline") => {
    if (busy.current) return;
    busy.current = true;
    const result = actions.decideApproval(approval.id, decision);
    if (result.ok) {
      onDecided?.(
        decision === "approve"
          ? `Approved. ${amountLabel} was sent from ${teenName}'s wallet.`
          : `Declined. No money moved — ${teenName} has been told.`,
      );
    } else {
      setError(result.error.message);
      busy.current = false;
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
          Approval requested
        </p>
        <span className="text-xs text-ink-faint">
          {formatDateTime(approval.createdAt)}
        </span>
      </div>
      <p className="mt-4 text-sm text-ink-muted">{teenName} wants to send</p>
      <AmountDisplay value={approval.amount} size="lg" className="mt-1" />
      <div className="mt-2 flex items-center gap-2.5">
        <Avatar
          name={approval.recipientName}
          initials={initialsOf(approval.recipientName)}
          size="sm"
        />
        <p className="min-w-0 truncate text-sm text-ink">
          to {approval.recipientName}
          {approval.note ? <span className="text-ink-muted"> · “{approval.note}”</span> : null}
        </p>
      </div>
      {status.dailyLimit !== null && (
        <p className="mt-4 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
          Today: {formatINR(status.todaySpent)} spent of the{" "}
          {formatINR(status.dailyLimit)} daily limit. Approving lets this
          payment through and counts it toward today.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {!mayDecide ? (
        <p className="mt-5 text-sm text-ink-muted">
          Only the parent or guardian this was sent to can decide.
        </p>
      ) : (
      <div className="mt-5 flex gap-2.5">
        <Button
          variant="secondary"
          className="flex-1"
          aria-label={`Decline ${amountLabel}`}
          onClick={() => decide("decline")}
        >
          Decline
        </Button>
        <Button
          className="flex-1"
          aria-label={`Approve ${amountLabel}`}
          onClick={() => decide("approve")}
        >
          Approve
        </Button>
      </div>
      )}
    </Card>
  );
}

/** The teen's view of a request that's waiting for their guardian. */
export function TeenApprovalCard({ approval }: { approval: ApprovalRequest }) {
  const { state, actions } = useSandbox();
  const [error, setError] = useState<string | null>(null);
  const guardianName = findUser(state, approval.guardianId)?.displayName ?? "your guardian";
  const amountLabel = `${formatINR(approval.amount)} to ${approval.recipientName}`;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
          <Clock className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {approval.recipientName}
            {approval.note ? <span className="text-ink-muted"> · {approval.note}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Waiting for {guardianName}&apos;s approval
          </p>
        </div>
        <div className="shrink-0 text-right">
          <AmountDisplay value={approval.amount} size="sm" tone="muted" />
          <Badge tone="warning" className="mt-1">
            Pending approval
          </Badge>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-line pt-3.5">
        <p className="text-xs text-ink-faint">Nothing moves until it&apos;s approved.</p>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Cancel approval request for ${amountLabel}`}
          onClick={() => {
            const result = actions.cancelApproval(approval.id);
            if (!result.ok) setError(result.error.message);
          }}
        >
          Cancel request
        </Button>
      </div>
    </Card>
  );
}
