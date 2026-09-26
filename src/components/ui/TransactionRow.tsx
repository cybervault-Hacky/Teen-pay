import {
  ArrowDownLeft,
  ArrowLeftRight,
  BookOpen,
  Bus,
  CircleDot,
  Clapperboard,
  Coffee,
  ShoppingBag,
  Target,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { Transaction, TransactionCategory } from "@/domain";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Amount } from "./Amount";
import { Badge } from "./Badge";

const categoryIcons: Record<TransactionCategory, LucideIcon> = {
  family: UsersRound,
  food: Coffee,
  transport: Bus,
  shopping: ShoppingBag,
  education: BookOpen,
  entertainment: Clapperboard,
  goals: Target,
  transfer: ArrowLeftRight,
  other: CircleDot,
};

export interface TransactionRowProps {
  transaction: Transaction;
  onSelect?: (transaction: Transaction) => void;
}

/** Single activity row — icon tile, title, counterparty · time, amount. */
export function TransactionRow({ transaction: tx, onSelect }: TransactionRowProps) {
  const Icon = tx.direction === "in" && tx.category === "transfer"
    ? ArrowDownLeft
    : categoryIcons[tx.category];

  const content = (
    <>
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted"
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[15px] font-medium text-ink">
          {tx.title}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-faint">
          {tx.counterparty.name} · {formatTime(tx.occurredAt)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Amount value={tx.amountPaise} direction={tx.direction} signed />
        {tx.status === "pending" && (
          <Badge tone="warning" dot>
            Pending
          </Badge>
        )}
      </span>
    </>
  );

  const classes = cn(
    "flex w-full items-center gap-3.5 rounded-xl px-2 py-2.5 transition-colors duration-150",
    onSelect && "cursor-pointer hover:bg-surface-2 active:bg-surface-3",
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(tx)}
        aria-label={`${tx.title}, ${tx.counterparty.name}`}
        className={cn(classes, "text-left")}
      >
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}
