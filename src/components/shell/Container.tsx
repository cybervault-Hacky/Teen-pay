import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ContainerWidth = "narrow" | "default" | "wide";

const widthStyles: Record<ContainerWidth, string> = {
  narrow: "max-w-[560px]",
  default: "max-w-[720px]",
  wide: "max-w-[1080px]",
};

export interface ContainerProps {
  width?: ContainerWidth;
  children: ReactNode;
  className?: string;
}

/** Centered content column with safe horizontal padding. */
export function Container({ width = "default", children, className }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6", widthStyles[width], className)}>
      {children}
    </div>
  );
}
