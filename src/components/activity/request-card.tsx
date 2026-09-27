"use client";

import type { MoneyRequest } from "@/domain";
import { formatDayLabel, initialsOf } from "@/lib/format";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface RequestCardProps {
  request: MoneyRequest;
}

/**
 * A pending money request. Creating it moved nothing — only
 * "Simulate paid" touches the ledger (a credit), and only once.
 */
export function RequestCard({ request }: RequestCardProps) {
  const { state, actions } = useSandbox();
  const recipient =
    state.recipients.find((r) => r.id === request.recipientId) ?? null;
  const name = recipient?.name ?? "Recipient";

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3.5">
        <Avatar
          name={name}
          initials={recipient ? initialsOf(recipient.name) : "?"}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {name}
            {request.note ? (
              <span className="text-ink-muted"> · {request.note}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Requested {formatDayLabel(request.createdAt)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <AmountDisplay value={request.amount} size="sm" tone="muted" />
          <Badge tone="warning" className="mt-1">
            Pending
          </Badge>
        </div>
      </div>
      <div className="mt-3.5 flex gap-2 border-t border-line pt-3.5">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => actions.respondToRequest(request.id, "paid")}
        >
          Simulate paid
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => actions.respondToRequest(request.id, "cancelled")}
        >
          Cancel
        </Button>
      </div>
    </Card>
  );
}
