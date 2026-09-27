import { IndianRupee } from "lucide-react";
import { cn } from "@/lib/cn";

interface AppLogoProps {
  className?: string;
}

/** The TeenPay wordmark: a rupee mark on the accent tile. */
export function AppLogo({ className }: AppLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-on-accent"
      >
        <IndianRupee className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        TeenPay
      </span>
    </span>
  );
}
