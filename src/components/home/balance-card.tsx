import { formatINR } from "@/lib/currency";
import { AmountDisplay } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BalanceAnnouncer } from "@/components/wallet/balance-announcer";
import type { User } from "@/domain";

interface BalanceCardProps {
  user: User;
  /** Derived available balance (whole rupees). */
  available: number;
  /** Derived total across all spaces. */
  total: number;
}

/**
 * The hero of the Home screen: the available balance, derived
 * from the sandbox ledger. Clearly marked as a sandbox.
 */
export function BalanceCard({ user, available, total }: BalanceCardProps) {
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      {/* A single, very quiet accent glow — texture without noise. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-24 h-48 w-48 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="relative">
        <BalanceAnnouncer amount={available} />
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Available balance
          </p>
          <Badge tone="warning">Sandbox</Badge>
        </div>
        <AmountDisplay value={available} size="display" className="mt-3" />
        <p className="mt-2.5 text-sm text-ink-muted">
          {user.displayName}&apos;s wallet · {formatINR(total)} total
        </p>
      </div>
    </Card>
  );
}
