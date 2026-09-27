import Link from "next/link";
import { Snowflake } from "lucide-react";
import type { Wallet } from "@/domain";

/**
 * Shown wherever money would move while a wallet is frozen. States
 * the status in words (never colour alone) and what still works.
 */
export function FrozenBanner({
  wallet,
  ownerName,
  frozenByName,
  href,
}: {
  wallet: Wallet;
  /** "Your" or "Aarav's". */
  ownerName: string;
  frozenByName?: string;
  /** Where the freeze can be managed. */
  href?: string;
}) {
  if (wallet.status === "active") return null;
  const closed = wallet.status === "closed";
  return (
    <div
      role="note"
      aria-label={closed ? "Wallet closed" : "Wallet frozen"}
      className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-accent/[0.07] px-4 py-3.5"
    >
      <Snowflake className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-ink">
          {ownerName} wallet is {closed ? "closed" : "frozen"}
          {!closed && frozenByName ? ` by ${frozenByName}` : ""}
        </p>
        <p className="mt-0.5 text-ink-muted">
          Balance and history stay visible. Payments, transfers and pocket money are paused
          {closed ? "." : " until it's unfrozen."}
        </p>
      </div>
      {href && !closed && (
        <Link
          href={href}
          className="shrink-0 self-center rounded-full px-2 py-1 text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          Manage
        </Link>
      )}
    </div>
  );
}
