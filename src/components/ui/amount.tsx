import { cn } from "@/lib/cn";
import { formatINR, formatINRWithSign } from "@/lib/currency";

type AmountSize = "sm" | "md" | "lg" | "display";
type AmountTone = "default" | "muted" | "success" | "danger";

interface AmountDisplayProps {
  /** Whole rupees. */
  value: number;
  size?: AmountSize;
  tone?: AmountTone;
  /** Show a leading + / - sign (ledger rows). */
  signed?: boolean;
  className?: string;
}

const sizeClasses: Record<AmountSize, string> = {
  sm: "text-[15px] font-medium",
  md: "text-lg font-medium",
  lg: "text-2xl font-semibold tracking-tight",
  display: "text-[40px] font-semibold leading-[1.08] tracking-tight",
};

const toneClasses: Record<AmountTone, string> = {
  default: "text-ink",
  muted: "text-ink-muted",
  success: "text-success",
  danger: "text-danger",
};

/**
 * The only place in the app where money is rendered.
 * Tabular numerals keep lists and balances perfectly aligned.
 */
export function AmountDisplay({
  value,
  size = "md",
  tone = "default",
  signed,
  className,
}: AmountDisplayProps) {
  const text = signed ? formatINRWithSign(value) : formatINR(value);
  return (
    <span
      className={cn(
        "tabular-nums whitespace-nowrap",
        sizeClasses[size],
        toneClasses[tone],
        className,
      )}
    >
      {text}
    </span>
  );
}
