"use client";

import { useRef, useState } from "react";
import { ShieldCheck, Snowflake } from "lucide-react";
import { walletStatusLabel, type Wallet } from "@/domain";
import { formatFullDateTime } from "@/lib/format";
import { getBalance } from "@/sandbox/selectors";
import { findUser } from "@/sandbox/identity";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { BalanceAnnouncer } from "./balance-announcer";

/**
 * A wallet's state: available balance (derived from the ledger),
 * status in words, and the sandbox freeze switch. Freezing is a
 * sandbox safety control — not a card or bank freeze. The decision
 * (who may freeze or unfreeze) is made in the domain; this only
 * offers what's likely to be allowed and shows the domain's answer.
 */
export function WalletCard({
  wallet,
  title = "Wallet",
  showBalance = true,
}: {
  wallet: Wallet;
  title?: string;
  /** Off where the balance is already shown nearby (never show it twice). */
  showBalance?: boolean;
}) {
  const { state, actions, viewer } = useSandbox();
  const [target, setTarget] = useState<"frozen" | "active" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const balance = getBalance(state, wallet.id);
  const owner = findUser(state, wallet.ownerAccountId);
  const isOwner = wallet.ownerAccountId === viewer.id;
  const ownerLabel = isOwner ? "your" : `${owner?.displayName ?? "their"}'s`;
  const frozenBy = wallet.statusChangedBy ? findUser(state, wallet.statusChangedBy) : null;
  const frozenByOther = wallet.status === "frozen" && isOwner && frozenBy && frozenBy.id !== viewer.id;
  const canToggle = wallet.status !== "closed" && !frozenByOther && owner?.role === "teen";

  const confirm = () => {
    // The target is fixed when the sheet opens, so a double click can
    // only ever repeat the same (idempotent) request.
    if (!target || busy.current) return;
    busy.current = true;
    const result = actions.setWalletFrozen(wallet.id, target === "frozen");
    busy.current = false;
    if (result.ok) {
      setTarget(null);
      setError(null);
    } else {
      setError(result.error.message);
    }
  };

  const frozen = wallet.status === "frozen";

  return (
    <Card className="p-5 sm:p-6">
      {showBalance && <BalanceAnnouncer amount={balance} />}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{title}</p>
        <Badge tone={wallet.status === "active" ? "success" : "accent"}>
          {frozen ? (
            <Snowflake className="h-3 w-3" aria-hidden />
          ) : (
            <ShieldCheck className="h-3 w-3" aria-hidden />
          )}
          <span>
            <span className="sr-only">Wallet status: </span>
            {walletStatusLabel(wallet.status)}
          </span>
        </Badge>
      </div>
      {showBalance && (
        <>
          <p className="mt-3 text-sm text-ink-muted">Available balance</p>
          <AmountDisplay value={balance} size="lg" className="mt-1" />
        </>
      )}
      <p className="mt-3 text-sm text-ink-muted">
        {wallet.status === "active"
          ? "Money can move normally."
          : frozen
            ? `Frozen${frozenBy ? ` by ${frozenBy.id === viewer.id ? "you" : frozenBy.displayName}` : ""}${
                wallet.statusChangedAt ? ` on ${formatFullDateTime(wallet.statusChangedAt)}` : ""
              }. Balance and history stay visible; payments, transfers and pocket money are paused.`
            : "This wallet is closed. Its history stays available."}
      </p>
      {frozenByOther && (
        <p className="mt-2 text-sm text-ink-muted">
          Only {frozenBy?.displayName ?? "your parent/guardian"} can unfreeze it.
        </p>
      )}
      {canToggle && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => {
            setError(null);
            setTarget(frozen ? "active" : "frozen");
          }}
        >
          <Snowflake className="h-4 w-4" aria-hidden />
          {frozen ? "Unfreeze wallet" : "Freeze wallet"}
        </Button>
      )}
      {error && !target && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target === "frozen" ? `Freeze ${ownerLabel} wallet?` : `Unfreeze ${ownerLabel} wallet?`}
      >
        <p className="-mt-2 text-sm text-ink-muted">
          {target === "frozen"
            ? "No money can move in or out while it's frozen — payments, transfers and pocket money are paused. The balance and history stay visible. This is a sandbox control, not a bank or card freeze."
            : "Money will be able to move again straight away."}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={confirm}>
            {target === "frozen" ? "Freeze" : "Unfreeze"}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
