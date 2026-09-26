"use client";

import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { pressable, transitionFast } from "@/design/motion";
import { cn } from "@/lib/cn";
import { iconButtonClassName } from "./iconButtonStyles";
import type { IconButtonSize, IconButtonVariant } from "./iconButtonStyles";

export type {
  IconButtonSize,
  IconButtonStyleOptions,
  IconButtonVariant,
} from "./iconButtonStyles";

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
        iconButtonClassName({ variant, size, className }),
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
