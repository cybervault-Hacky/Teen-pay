"use client";

import { motion } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { pressable, transitionFast } from "@/design/motion";
import { cn } from "@/lib/cn";
import { buttonClassName } from "./buttonStyles";
import type { ButtonSize, ButtonVariant } from "./buttonStyles";

export type { ButtonSize, ButtonStyleOptions, ButtonVariant } from "./buttonStyles";

export interface ButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
  > {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
}

/**
 * Primary action control. Always `type="button"` by default so it never
 * submits a form accidentally — pass `type="submit"` explicitly in forms.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      type={type}
      disabled={isDisabled}
      whileTap={isDisabled ? undefined : pressable.whileTap}
      transition={transitionFast}
      className={cn(
        buttonClassName({ variant, size, fullWidth, className }),
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </motion.button>
  );
}
