import { formatINR, formatSignedINR } from "@/lib/format";
import { cn } from "@/lib/cn";

export type AmountSize = "display" | "lg" | "md" | "sm";
export type AmountTone = "default" | "muted" | "positive" | "negative";

const sizeStyles: Record<AmountSize, string> = {
  display: "text-[40px] leading-none font-bold tracking-tight",
  lg: "text-2xl font-bold tracking-tight",
  md: "text-[15px] font-semibold",
  sm: "text-[13px] font-semibold",
};

const toneStyles: Record<AmountTone, string> = {
  default: "text-ink",
  muted: "text-muted",
  positive: "text-success",
  negative: "text-ink",
};

export interface AmountProps {
  /** Integer paise. */
  value: number;
  size?: AmountSize;
  tone?: AmountTone;
  /** Show an explicit +/− sign (ledger rows). */
  signed?: boolean;
  /** Direction used for the sign and, by default, the tone. */
  direction?: "in" | "out";
  exact?: boolean;
  className?: string;
}

/**
 * The ONLY way to render money. Guarantees tabular numerals, correct
 * INR grouping, and consistent sizing across the product.
 */
export function Amount({
  value,
  size = "md",
  tone,
  signed = false,
  direction,
  exact = false,
  className,
}: AmountProps) {
  const resolvedTone: AmountTone =
    tone ?? (direction === "in" ? "positive" : direction === "out" ? "negative" : "default");
  const text =
    signed && direction
      ? formatSignedINR(value, direction)
      : formatINR(value, { exact });

  return (
    <span className={cn("tnum", sizeStyles[size], toneStyles[resolvedTone], className)}>
      {text}
    </span>
  );
}
