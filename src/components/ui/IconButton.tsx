"use client";

import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { pressable, transitionFast } from "@/design/motion";
import { cn } from "@/lib/cn";

export type IconButtonVariant = "subtle" | "ghost" | "outline" | "accent";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
  > {
  /** Accessible name — required, never render an unlabeled icon button. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const variantStyles: Record<IconButtonVariant, string> = {
  subtle: "bg-surface-2 text-muted hover:text-ink hover:bg-surface-3",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  outline: "border border-line-strong text-muted hover:text-ink hover:bg-surface-2",
  accent: "bg-accent-soft text-accent border border-accent-line hover:bg-accent/20",
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: "size-8 rounded-lg [&_svg]:size-4",
  md: "size-10 rounded-xl [&_svg]:size-5",
  lg: "size-12 rounded-2xl [&_svg]:size-6",
};

export function IconButton({
  label,
  variant = "subtle",
  size = "md",
  className,
  children,
  type = "button",
  disabled,
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <motion.button
      ref={ref}
      type={type}
      aria-label={label}
      disabled={disabled}
      whileTap={disabled ? undefined : pressable.whileTap}
      transition={transitionFast}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
