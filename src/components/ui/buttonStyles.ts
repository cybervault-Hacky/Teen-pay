import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export const buttonVariantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-[0_8px_24px_-8px_var(--tp-accent)]",
  secondary:
    "bg-surface-2 text-ink border border-line-strong hover:bg-surface-3 active:bg-surface-3",
  ghost: "text-muted hover:text-ink hover:bg-surface-2 active:bg-surface-3",
  danger: "bg-danger-soft text-danger-ink border border-danger/30 hover:bg-danger/20",
};

export const buttonSizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[13px] rounded-xl gap-1.5",
  md: "h-11 px-5 text-sm rounded-xl gap-2",
  lg: "h-[52px] px-6 text-[15px] rounded-2xl gap-2",
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/**
 * Shared button styling for non-button elements (e.g. a Next.js Link
 * that must look like a button without nesting interactive elements).
 * Server-safe — no client dependencies.
 */
export function buttonClassName({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    "inline-flex cursor-pointer items-center justify-center font-semibold whitespace-nowrap transition-[background-color,color,filter] duration-150 select-none",
    buttonVariantStyles[variant],
    buttonSizeStyles[size],
    fullWidth && "w-full",
    className,
  );
}
