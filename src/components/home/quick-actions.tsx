import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  PiggyBank,
  Send,
  type LucideIcon,
} from "lucide-react";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  href: string;
}

const actions: QuickAction[] = [
  // Phase 8: TeenPay-to-TeenPay money first; Pay stays for contacts.
  { label: "Send", icon: Send, href: "/send" },
  { label: "Request", icon: ArrowDownLeft, href: "/request" },
  { label: "Pay", icon: ArrowUpRight, href: "/pay" },
  { label: "Save", icon: PiggyBank, href: "/money" },
];

/**
 * The four primary intents of the product, one tap deep.
 * Destinations are real routes with real flows.
 */
export function QuickActions() {
  return (
    <ul className="grid grid-cols-4 gap-2 sm:gap-3">
      {actions.map(({ label, icon: Icon, href }) => (
        <li key={label}>
          <Link
            href={href}
            className="group flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-2 py-3.5 transition-[border-color,background-color,transform] duration-150 hover:border-line-strong hover:bg-surface-2 active:scale-[0.98]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-ink transition-colors duration-150 group-hover:text-accent">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-xs font-medium text-ink-muted transition-colors duration-150 group-hover:text-ink">
              {label}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
