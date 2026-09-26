"use client";

import { Eye, EyeOff, TrendingDown, TrendingUp } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { sumByDirection } from "@/domain";
import { useSandbox } from "@/sandbox";
import { Amount, Card, IconButton, SandboxBadge } from "@/components/ui";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const subscribeToTimeOfDay = () => () => {};

/** Hero balance card — greeting, hideable derived balance, month in/out. */
export function BalanceCard() {
  const [hidden, setHidden] = useState(false);
  const { teen, wallet, transactions } = useSandbox();
  // Time-based greeting without hydration mismatch: stable "Hello" on the
  // server, local time on the client.
  const greeting = useSyncExternalStore(
    subscribeToTimeOfDay,
    () => greetingFor(new Date().getHours()),
    () => "Hello",
  );
  const firstName = teen.displayName.split(" ")[0];

  const monthIn = sumByDirection(transactions, "in");
  const monthOut = sumByDirection(transactions, "out");

  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-accent/[0.07] blur-2xl"
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-muted">
            {greeting}, {firstName}
          </p>
          <p className="mt-3 text-xs font-semibold tracking-[0.08em] text-faint uppercase">
            Available balance
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <IconButton
            label={hidden ? "Show balance" : "Hide balance"}
            variant="ghost"
            size="sm"
            aria-pressed={hidden}
            onClick={() => setHidden((v) => !v)}
          >
            {hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </IconButton>
        </div>
      </div>

      <div className="mt-1" aria-live="polite">
        {hidden ? (
          <p aria-label="Balance hidden" className="text-[40px] leading-none font-bold tracking-tight text-ink">
            ••••
          </p>
        ) : (
          <Amount value={wallet.availablePaise} size="display" />
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <TrendingUp className="size-4 text-success" aria-hidden="true" />
            <Amount value={monthIn} size="sm" tone="muted" />
            <span className="text-faint">in</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <TrendingDown className="size-4 text-danger" aria-hidden="true" />
            <Amount value={monthOut} size="sm" tone="muted" />
            <span className="text-faint">out</span>
          </span>
        </div>
        <SandboxBadge />
      </div>
    </Card>
  );
}
