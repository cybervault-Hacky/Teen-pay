/**
 * Wallet domain.
 *
 * Each teen owns exactly one wallet. The wallet balance is *partitioned*
 * into Money Spaces — sub-accounts that ring-fence money by intent
 * (spend / save / goals). "Upcoming" is not a balance; it tracks money
 * expected to arrive (allowance, scheduled transfers).
 *
 * Invariants (enforced by tests on mock data, by the ledger later):
 * - available = spend + save + goals
 * - every space balance >= 0
 *
 * Money is always integer paise. Never use floats for money.
 */

import type { UserId } from "./user";

export type Currency = "INR";

/** Integer minor units (paise). */
export type MinorUnits = number;

export type SpaceType = "spend" | "save" | "goals" | "upcoming";

export interface MoneySpace {
  type: SpaceType;
  /** Display label, e.g. "Spend". */
  label: string;
  /** One-line explanation of the space's intent. */
  description: string;
  balancePaise: MinorUnits;
  currency: Currency;
}

export interface TeenWallet {
  teenId: UserId;
  currency: Currency;
  /** Spendable right now — always equals spend + save + goals. */
  availablePaise: MinorUnits;
  spaces: Record<Exclude<SpaceType, "upcoming">, MoneySpace>;
  /** Expected money (allowance, scheduled top-ups). Not spendable yet. */
  upcomingPaise: MinorUnits;
}

/** Domain invariant check shared by UI guards and tests. */
export function walletInvariantHolds(wallet: TeenWallet): boolean {
  const { spend, save, goals } = wallet.spaces;
  const parts = [spend.balancePaise, save.balancePaise, goals.balancePaise];
  if (parts.some((p) => !Number.isInteger(p) || p < 0)) return false;
  if (!Number.isInteger(wallet.availablePaise) || wallet.availablePaise < 0) return false;
  return spend.balancePaise + save.balancePaise + goals.balancePaise === wallet.availablePaise;
}

export function spaceShare(spacePaise: MinorUnits, availablePaise: MinorUnits): number {
  if (availablePaise <= 0) return 0;
  return Math.min(1, Math.max(0, spacePaise / availablePaise));
}
