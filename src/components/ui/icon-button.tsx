import { forwardRef } from "react";
import { cn } from "@/lib/cn";

interface IconButtonProps
  extends React.ComponentPropsWithoutRef<"button"> {
  /** Accessible label — required, since the icon conveys no text. */
  label: string;
  variant?: "default" | "ghost";
  size?: "sm" | "md";
}

const sizeClasses = {
  sm: "h-9 w-9 rounded-lg",
  md: "h-11 w-11 rounded-xl",
} as const;

const variantClasses = {
  default:
    "border border-line bg-surface-2 text-ink hover:bg-surface-3 hover:text-ink",
  ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink",
} as const;

/**
 * A square button that holds a single icon. Always requires an
 * accessible label so icon-only controls stay screen-reader safe.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, variant = "default", size = "md", className, type, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center justify-center transition-[background-color,color,transform] duration-150",
          "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.96]",
          sizeClasses[size],
          variantClasses[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
