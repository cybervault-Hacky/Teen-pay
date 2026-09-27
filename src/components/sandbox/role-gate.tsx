"use client";

import { ArrowLeftRight } from "lucide-react";
import { roleLabel, type UserRole } from "@/domain";
import { homeHrefFor } from "@/lib/navigation";
import { selectSession } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface RoleGateProps {
  /** The sandbox role this screen is for. */
  role: UserRole;
  children: React.ReactNode;
}

/**
 * Shows a screen only in the sandbox role it belongs to. In the
 * other role it explains why, and offers a transparent switch.
 * The engine enforces permissions too — this is just clarity.
 */
export function RoleGate({ role, children }: RoleGateProps) {
  const { state, actions, switchTargets } = useSandbox();
  const session = selectSession(state);
  if (session.role === role) return <>{children}</>;

  const owner = switchTargets[role];
  const ownerName = owner?.displayName ?? roleLabel(role);

  return (
    <Card className="p-6 sm:p-8">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
        <ArrowLeftRight className="h-5 w-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">
        {role === "teen" ? `This is ${ownerName}'s space` : "Parent view"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        You&apos;re using the sandbox as {session.user.displayName} (
        {roleLabel(session.role)}).{" "}
        {role === "teen"
          ? `This screen belongs to the teen view.`
          : "Switch the sandbox role to see the parent/guardian perspective."}
      </p>
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
        <Button onClick={() => actions.switchRole(role)}>
          Switch to {roleLabel(role)}
        </Button>
        <Button variant="secondary" href={homeHrefFor(session.role)}>
          {session.role === "parent" ? "Go to family overview" : "Back to Home"}
        </Button>
      </div>
      <p className="mt-5 text-xs text-ink-faint">
        Sandbox role switching is a demo feature — it isn&apos;t sign-in and
        verifies no one.
      </p>
    </Card>
  );
}
