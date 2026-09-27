import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CornerUpLeft,
  PiggyBank,
  RotateCcw,
  Sparkles,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { LedgerEntry } from "@/domain";

/**
 * Consistent icon for a ledger entry, by its type. Every list in
 * the app renders from this single mapping.
 */
export function entryIcon(entry: Pick<LedgerEntry, "type">): LucideIcon {
  switch (entry.type) {
    case "allowance_credit":
    case "payment_received":
    case "transfer_in":
      return ArrowDownLeft;
    case "refund":
      return RotateCcw;
    case "reversal":
      return Undo2;
    case "deposit":
      return Sparkles;
    case "transfer_out":
      return ArrowLeftRight;
    case "space_allocation":
      return PiggyBank;
    case "space_release":
      return CornerUpLeft;
    case "payment_sent":
    case "allowance_debit":
    case "adjustment":
      return ArrowUpRight;
  }
}
