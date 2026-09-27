import { cn } from "@/lib/cn";

interface CardProps extends React.ComponentPropsWithoutRef<"div"> {
  /** Adds a calm hover state for tappable cards. */
  interactive?: boolean;
}

/**
 * The default elevated surface. One of the two surfaces in the
 * system — use `Surface` when you need something less opinionated.
 */
export function Card({ interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface",
        interactive &&
          "transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}
