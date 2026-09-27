import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<React.ComponentPropsWithoutRef<"button">, "href"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When set, the button renders as an internal link. */
  href?: string;
  fullWidth?: boolean;
}

const baseClasses =
  "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium " +
  "transition-[transform,background-color,border-color,color] duration-150 " +
  "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-strong",
  secondary: "border border-line bg-surface-2 text-ink hover:bg-surface-3",
  ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger/10 text-danger hover:bg-danger/20",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

/**
 * The primary call-to-action primitive. Renders a <button>, or an
 * internal <Link> when `href` is provided.
 */
export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    href,
    fullWidth,
    type,
    className,
    ...props
  },
  ref,
) {
  const classes = cn(
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && "w-full",
    className,
  );

  if (href !== undefined) {
    const { disabled, ...linkProps } = props;
    return (
      <Link
        {...(linkProps as React.ComponentProps<typeof Link>)}
        href={href}
        aria-disabled={disabled || undefined}
        className={classes}
        ref={ref as React.Ref<HTMLAnchorElement>}
      />
    );
  }

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={type ?? "button"}
      className={classes}
      {...props}
    />
  );
});
