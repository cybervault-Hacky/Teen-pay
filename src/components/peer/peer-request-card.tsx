"use client";

import { useState } from "react";
import { formatINR } from "@/lib/currency";
import { formatDayLabel } from "@/lib/format";
import type { PeerRequestView } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface RequestOutcomeMessage {
  tone: "success" | "error";
  text: string;
}

const STATUS_TONE = {
  pending: "warning",
  accepted: "success",
  declined: "neutral",
  cancelled: "neutral",
  expired: "neutral",
} as const;

/**
 * One TeenPay money request, from the viewer's side. Buttons follow
 * the rules the engine enforces anyway: the payer pays or declines,
 * the requester cancels, and only while pending. Paying asks for a
 * confirmation first; the engine re-checks everything on confirm.
 */
export function PeerRequestCard({
  request,
  onOutcome,
}: {
  request: PeerRequestView;
  onOutcome: (message: RequestOutcomeMessage) => void;
}) {
  const { actions } = useSandbox();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const incoming = request.direction === "incoming";
  const pending = request.status === "pending";
  const amount = formatINR(request.amount);
  const title = incoming
    ? `${amount} requested by ${request.party.handle}`
    : `${amount} requested from ${request.party.handle}`;

  const pay = () => {
    const result = actions.acceptMoneyRequest(request.requestId);
    if (!result.ok) {
      setError(result.error.message);
      setConfirming(false);
      return;
    }
    setError(null);
    setConfirming(false);
    onOutcome({
      tone: "success",
      text:
        result.value.status === "completed"
          ? `Paid ${amount} to ${request.party.handle} · ${result.value.reference}`
          : `${result.value.guardianName} has been asked to approve paying ${amount}. Nothing has moved yet.`,
    });
  };

  const decline = () => {
    const result = actions.declineMoneyRequest(request.requestId);
    if (!result.ok) return setError(result.error.message);
    onOutcome({ tone: "success", text: `Declined ${request.party.handle}'s ${amount} request. No money moved.` });
  };

  const cancel = () => {
    const result = actions.cancelMoneyRequest(request.requestId);
    if (!result.ok) return setError(result.error.message);
    onOutcome({ tone: "success", text: `Cancelled your ${amount} request. No money moved.` });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3.5">
        <Avatar name={request.party.name} initials={request.party.initials} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          {request.note && <p className="mt-0.5 truncate text-sm text-ink-muted">“{request.note}”</p>}
          <p className="mt-0.5 text-xs text-ink-faint">
            {pending
              ? `Sent ${formatDayLabel(request.createdAt)} · expires ${formatDayLabel(request.expiresAt)}`
              : `${request.statusLabel} ${formatDayLabel(request.respondedAt ?? request.expiresAt)}`}
            {request.reference ? ` · ${request.reference}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <AmountDisplay value={request.amount} size="sm" tone="muted" />
          <Badge tone={STATUS_TONE[request.status]} className="mt-1">
            {request.awaitingApproval ? "Awaiting approval" : request.statusLabel}
          </Badge>
        </div>
      </div>

      {pending && incoming && !confirming && (
        <div className="mt-3.5 flex gap-2 border-t border-line pt-3.5">
          <Button variant="ghost" size="sm" className="flex-1" onClick={decline}>
            Decline
          </Button>
          {!request.awaitingApproval && (
            <Button size="sm" className="flex-1" onClick={() => setConfirming(true)}>
              Pay {amount}
            </Button>
          )}
        </div>
      )}
      {pending && incoming && confirming && (
        <div className="mt-3.5 border-t border-line pt-3.5">
          <p className="text-sm text-ink">
            Pay {amount} to {request.party.handle} from your available balance?
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button size="sm" className="flex-1" onClick={pay}>
              Confirm {amount}
            </Button>
          </div>
        </div>
      )}
      {pending && !incoming && (
        <div className="mt-3.5 flex gap-2 border-t border-line pt-3.5">
          <Button variant="ghost" size="sm" className="flex-1" onClick={cancel}>
            Cancel request
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {pending && request.awaitingApproval && (
        <p className="mt-3 text-xs text-ink-faint">
          Waiting for your parent to approve. Nothing has moved yet.
        </p>
      )}
    </Card>
  );
}
