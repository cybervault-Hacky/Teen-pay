import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Elevated surface — the default container for grouped content.
 * Padding comes from the caller so density stays intentional.
 */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export type SurfaceLevel = 1 | 2 | 3;

const levelStyles: Record<SurfaceLevel, string> = {
  1: "bg-surface",
  2: "bg-surface-2",
  3: "bg-surface-3",
};

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  level?: SurfaceLevel;
  children: ReactNode;
}

/** Lower-level tonal surface for nesting inside cards and sheets. */
export function Surface({ level = 2, className, children, ...rest }: SurfaceProps) {
  return (
    <div className={cn("rounded-xl", levelStyles[level], className)} {...rest}>
      {children}
    </div>
  );
}
