import { cn } from "@/lib/cn";

export type IconButtonVariant = "subtle" | "ghost" | "outline" | "accent";
export type IconButtonSize = "sm" | "md" | "lg";

export const iconButtonVariantStyles: Record<IconButtonVariant, string> = {
  subtle: "bg-surface-2 text-muted hover:text-ink hover:bg-surface-3",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  outline: "border border-line-strong text-muted hover:text-ink hover:bg-surface-2",
  accent: "bg-accent-soft text-accent border border-accent-line hover:bg-accent/20",
};

export const iconButtonSizeStyles: Record<IconButtonSize, string> = {
  sm: "size-8 rounded-lg [&_svg]:size-4",
  md: "size-10 rounded-xl [&_svg]:size-5",
  lg: "size-12 rounded-2xl [&_svg]:size-6",
};

export interface IconButtonStyleOptions {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  className?: string;
}

/**
 * Shared icon-button styling for non-button elements (e.g. a Next.js Link
 * that must look like an icon button without nesting interactive elements).
 * Server-safe — no client dependencies.
 */
export function iconButtonClassName({
  variant = "subtle",
  size = "md",
  className,
}: IconButtonStyleOptions = {}): string {
  return cn(
    "inline-flex cursor-pointer items-center justify-center transition-colors duration-150 select-none",
    iconButtonVariantStyles[variant],
    iconButtonSizeStyles[size],
    className,
  );
}
