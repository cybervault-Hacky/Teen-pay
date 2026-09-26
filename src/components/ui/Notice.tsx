import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type NoticeTone = "neutral" | "info" | "success" | "warning";

const toneStyles: Record<NoticeTone, string> = {
  neutral: "border-line bg-surface-2 text-muted",
  info: "border-info/25 bg-info-soft text-info-ink",
  success: "border-success/25 bg-success-soft text-success-ink",
  warning: "border-warning/25 bg-warning-soft text-warning-ink",
};

const toneIcons: Record<NoticeTone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Inline banner for info, honesty labels ("Sample data") and soft warnings. */
export function Notice({ tone = "neutral", title, children, className }: NoticeProps) {
  const Icon = title ? CircleAlert : toneIcons[tone];
  return (
    <div
      role={tone === "warning" ? "alert" : "note"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed",
        toneStyles[tone],
        className,
      )}
    >
      <Icon className="mt-px size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-semibold text-ink">{title}</p>}
        <div className={cn(title && "mt-0.5 text-muted")}>{children}</div>
      </div>
    </div>
  );
}
