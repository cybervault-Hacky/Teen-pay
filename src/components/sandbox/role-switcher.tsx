"use client";

import { useId, useState } from "react";
import { roleLabel, type UserRole } from "@/domain";
import { cn } from "@/lib/cn";
import { selectSession } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Avatar } from "@/components/ui/avatar";

interface RoleSwitcherProps {
  className?: string;
  /** Called after a successful switch. */
  onSwitched?: (role: UserRole) => void;
}

const ROLES: UserRole[] = ["teen", "parent"];

/**
 * The transparent sandbox role switcher — a demo control, not
 * sign-in. It moves this device's sandbox session to the connected
 * (or first) account with the other role. Permissions still come
 * from that account's family membership, not from this control.
 */
export function RoleSwitcher({ className, onSwitched }: RoleSwitcherProps) {
  const { state, actions, switchTargets } = useSandbox();
  const { role: current } = selectSession(state);
  const labelId = useId();
  const [announcement, setAnnouncement] = useState("");

  const choose = (role: UserRole) => {
    if (role === current) return;
    const result = actions.switchRole(role);
    if (result.ok) {
      const user = switchTargets[role];
      setAnnouncement(
        `Now using the sandbox as ${user?.displayName ?? roleLabel(role)} (${roleLabel(role)}).`,
      );
      onSwitched?.(role);
    }
  };

  return (
    <div className={className}>
      <p id={labelId} className="text-sm font-medium text-ink">
        Sandbox role
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">
        A demo control, not sign-in. It moves this sandbox session to another
        fictional account — nothing is verified.
      </p>
      <div
        role="group"
        aria-labelledby={labelId}
        className="mt-3 grid grid-cols-2 gap-2"
      >
        {ROLES.map((role) => {
          const user = switchTargets[role];
          if (!user) return null;
          const active = role === current;
          return (
            <button
              key={role}
              type="button"
              aria-pressed={active}
              aria-label={`${roleLabel(role)} — ${user.displayName}`}
              onClick={() => choose(role)}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-3 text-left",
                "transition-[background-color,border-color] duration-150",
                active
                  ? "border-accent/40 bg-accent/10"
                  : "border-line bg-surface-2 hover:border-line-strong",
              )}
            >
              <Avatar name={user.name} initials={user.avatarInitials} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">
                  {roleLabel(role)}
                </span>
                <span className="block truncate text-xs text-ink-muted">
                  {user.displayName} · @{user.username}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-accent">
        {announcement}
      </p>
    </div>
  );
}
