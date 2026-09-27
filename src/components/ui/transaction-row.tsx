import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Transaction } from "@/domain";
import { AmountDisplay } from "./amount";

interface TransactionRowProps {
  transaction: Transaction;
  icon: LucideIcon;
  /** When provided, the row becomes a button (detail view). */
  onSelect?: () => void;
}

/**
 * One row in an activity list. Presentational only — data comes
 * from the domain layer, icons from `entryIcon`.
 */
export function TransactionRow({
  transaction,
  icon: Icon,
  onSelect,
}: TransactionRowProps) {
  const isMoneyIn = transaction.direction === "in";

  const content = (
    <>
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          isMoneyIn
            ? "bg-success/10 text-success"
            : "bg-surface-2 text-ink-muted",
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {transaction.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {transaction.subtitle}
          {transaction.statusLabel ? ` · ${transaction.statusLabel}` : ""}
        </p>
      </div>
      <AmountDisplay
        value={transaction.amount}
        signed
        size="sm"
        tone={isMoneyIn ? "success" : "default"}
      />
    </>
  );

  const layoutClasses = "flex items-center gap-3.5 px-5 py-3.5";

  if (onSelect) {
    return (
      <li>
        <button
          type="button"
          onClick={onSelect}
          aria-label={`${transaction.title}, ${transaction.when}${
            transaction.statusLabel ? `, ${transaction.statusLabel}` : ""
          }. Open details.`}
          className={cn(
            layoutClasses,
            "w-full rounded-xl text-left transition-colors duration-150 hover:bg-surface-2",
          )}
        >
          {content}
        </button>
      </li>
    );
  }

  return <li className={layoutClasses}>{content}</li>;
}
