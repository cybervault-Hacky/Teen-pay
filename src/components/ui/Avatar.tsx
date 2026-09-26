import { getInitials } from "@/lib/format";
import { cn } from "@/lib/cn";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const sizeStyles: Record<AvatarSize, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-[13px]",
  lg: "size-12 text-sm",
  xl: "size-16 text-lg",
};

/** Restrained tonal palette — deterministic per name, never garish. */
const tones = [
  "bg-accent-soft text-accent",
  "bg-info-soft text-info",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
] as const;

function toneFor(seed: string): (typeof tones)[number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return tones[hash % tones.length];
}

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  className?: string;
}

/** Initial-based avatar. No photos in Phase 1. */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-line-strong ring-inset",
        sizeStyles[size],
        toneFor(name),
        className,
      )}
    >
      {getInitials(name)}
    </span>
  );
}
