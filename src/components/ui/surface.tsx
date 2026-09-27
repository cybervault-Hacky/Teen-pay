import { cn } from "@/lib/cn";

type SurfaceTone = "default" | "raised" | "overlay";

interface SurfaceProps extends React.ComponentPropsWithoutRef<"div"> {
  tone?: SurfaceTone;
}

const toneClasses: Record<SurfaceTone, string> = {
  default: "bg-surface",
  raised: "bg-surface-2",
  /** Translucent surface for floating chrome (tab bar, sheets). */
  overlay: "bg-surface/90 backdrop-blur-md",
};

/**
 * A bare elevated container without card semantics. Use for chrome
 * and panels where Card's default styling is too opinionated.
 */
export function Surface({ tone = "default", className, ...props }: SurfaceProps) {
  return <div className={cn(toneClasses[tone], className)} {...props} />;
}
