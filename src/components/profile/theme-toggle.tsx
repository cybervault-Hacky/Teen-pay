"use client";

import { Moon, Sun, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { cn } from "@/lib/cn";

type Theme = "dark" | "light";

const options: { id: Theme; label: string; icon: LucideIcon }[] = [
  { id: "dark", label: "Dark", icon: Moon },
  { id: "light", label: "Light", icon: Sun },
];

const STORAGE_KEY = "teenpay-theme";

/**
 * Appearance control. Applies the theme to <html data-theme> and
 * persists the choice. Dark is the product default.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    const current =
      document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current);
    setMounted(true);
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); theme still applies.
    }
  };

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex rounded-xl border border-line bg-surface-2 p-1"
    >
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={mounted && theme === id}
          onClick={() => apply(id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5",
            "text-xs font-medium transition-colors duration-150",
            mounted && theme === id
              ? "bg-surface text-ink shadow-soft"
              : "text-ink-faint hover:text-ink",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
