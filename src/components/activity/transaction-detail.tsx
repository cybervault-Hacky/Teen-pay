"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { formatINR } from "@/lib/currency";
import { formatDateKey, formatFullDateTime } from "@/lib/format";
import { getTransaction, selectTeenWallet } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { Modal } from "@/components/ui/modal";

interface TransactionDetailProps {
  /** The ledger entry to show, or null when closed. */
  entryId: string | null;
  onClose: () => void;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs font-medium text-ink-faint">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * The read-only detail for a sandbox transaction, from the central
 * transaction query (so only entries in this account's scope can be
 * opened). Entries are immutable: a refund is a new, linked entry —
 * the original never changes.
 */
export function TransactionDetail({ entryId, onClose }: TransactionDetailProps) {
  const { state, actions, viewer } = useSandbox();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);

  const tx = entryId ? getTransaction(state, entryId) : null;
  const wallet = selectTeenWallet(state);
  const canRefund =
    tx !== null &&
    tx.refundable > 0 &&
    viewer.role === "teen" &&
    wallet?.ownerAccountId === viewer.id;

  const close = () => {
    setError(null);
    setNotice(null);
    onClose();
  };

  const refund = () => {
    if (!tx || busy.current) return;
    busy.current = true;
    const result = actions.simulateRefund(tx.id);
    busy.current = false;
    if (result.ok) {
      setError(null);
      setNotice(`Refund recorded · ${result.value.reference}`);
    } else {
      setNotice(null);
      setError(result.error.message);
    }
  };

  return (
    <Modal open={tx !== null} onClose={close} title="Transaction">
      {tx && (
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">{tx.typeLabel}</p>
              {tx.description !== tx.typeLabel && (
                <p className="mt-0.5 text-xs text-ink-muted">{tx.description}</p>
              )}
            </div>
            <AmountDisplay
              value={tx.amount}
              signed
              size="lg"
              tone={tx.direction === "in" ? "success" : "default"}
            />
          </div>
          <p className="sr-only">
            {tx.direction === "in" ? "Money in" : "Money out"}, {formatINR(tx.magnitude)}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Badge tone={tx.status === "completed" ? "success" : "neutral"}>{tx.statusText}</Badge>
            <Badge tone="warning">Sandbox</Badge>
          </div>

          <Divider className="my-5" />

          <dl className="space-y-3">
            <DetailRow label="Date">{formatFullDateTime(tx.createdAt)}</DetailRow>
            <DetailRow label="Direction">{tx.direction === "in" ? "Money in" : "Money out"}</DetailRow>
            {tx.space ? (
              <DetailRow label="Money Space">
                <Link
                  href={`/money/${tx.space.id}`}
                  onClick={close}
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  {tx.space.name}
                  {tx.space.archived ? " (archived)" : ""}
                </Link>
              </DetailRow>
            ) : (
              <DetailRow label={tx.counterparty.label}>{tx.counterparty.name}</DetailRow>
            )}
            <DetailRow label="Wallet">{tx.walletLabel}</DetailRow>
            {tx.approval && (
              <DetailRow label="Approval">
                Approved by {tx.approval.decidedByName}
              </DetailRow>
            )}
            {tx.compensates && <DetailRow label="Refund of">{tx.compensates}</DetailRow>}
            {tx.scheduledFor && (
              <DetailRow label="Scheduled for">{formatDateKey(tx.scheduledFor)}</DetailRow>
            )}
            {tx.compensatedBy.map((c) => (
              <DetailRow key={c.reference} label={c.kind === "refund" ? "Refunded" : "Reversed"}>
                {formatINR(c.amount)} · {c.reference}
              </DetailRow>
            ))}
            <DetailRow label="Reference">
              <span className="font-mono text-xs text-ink-muted">{tx.reference}</span>
            </DetailRow>
          </dl>

          {canRefund && (
            <div className="mt-5 rounded-2xl border border-line bg-surface-2 p-4">
              <p className="text-sm text-ink-muted">
                Sandbox: pretend {tx.counterparty.name} sent this back. The payment stays in your
                history; a linked refund adds {formatINR(tx.refundable)} to your balance. It
                doesn&apos;t give back today&apos;s spending limit.
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={refund}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                Sandbox: simulate refund
              </Button>
            </div>
          )}
          {notice && (
            <p role="status" className="mt-4 text-sm text-success">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}

          <p className="mt-5 text-xs text-ink-faint">
            Completed sandbox transactions can&apos;t be edited or deleted — corrections are
            recorded as new, linked entries.
          </p>
        </div>
      )}
    </Modal>
  );
}
