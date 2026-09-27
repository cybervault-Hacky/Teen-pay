"use client";

import { ChevronRight, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/provider";
import { formatUsername, roleLabel, type User } from "@/domain";
import { cn } from "@/lib/cn";
import { safeNextPath } from "@/lib/navigation";
import { useSandboxData } from "@/sandbox/store";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { SandboxAuthNotice } from "./sandbox-auth-notice";

/**
 * Sign-in for the sandbox: choose a fictional account on this device.
 * Clearly labelled as a sandbox session — no credentials exist.
 */
export function SignInScreen() {
  const auth = useAuth();
  const data = useSandboxData();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Signed in (just now, or already) → continue to the app.
  const session = auth.status === "authenticated" ? auth.session : null;
  useEffect(() => {
    if (session) router.replace(safeNextPath(next, session.role));
  }, [session, next, router]);

  const teens = data.directory.filter((a) => a.role === "teen");
  const parents = data.directory.filter((a) => a.role === "parent");
  const primaryTeen = teens[0] ?? null;
  const primaryParent = parents[0] ?? null;
  const others = data.directory.filter((a) => a !== primaryTeen && a !== primaryParent);
  const busy = auth.status === "authenticating" || pendingId !== null || !data.ready;

  const continueAs = async (account: User) => {
    setError(null);
    // Re-read: the account must still exist and be active.
    const current = data.findAccount(account.id);
    if (!current || current.status !== "active") {
      setError("That account isn't available any more. Choose another one.");
      return;
    }
    setPendingId(account.id);
    const result = await auth.signIn({ method: "sandbox", accountId: current.id, role: current.role });
    setPendingId(null);
    if (!result.ok) setError(result.message);
  };

  const notice = auth.notice ?? data.storageNotice;

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-ink focus:outline-none"
      >
        Welcome to TeenPay
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Choose how you want to use the sandbox.
      </p>

      {notice && (
        <div
          role={auth.status === "expired" ? "alert" : "status"}
          className="mt-5 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink"
        >
          {notice}
        </div>
      )}

      <div className="mt-6 space-y-2.5">
        {primaryTeen && (
          <AccountButton
            account={primaryTeen}
            label="Continue as Teen"
            pending={pendingId === primaryTeen.id}
            disabled={busy}
            onClick={() => void continueAs(primaryTeen)}
          />
        )}
        {primaryParent && (
          <AccountButton
            account={primaryParent}
            label="Continue as Parent"
            pending={pendingId === primaryParent.id}
            disabled={busy}
            onClick={() => void continueAs(primaryParent)}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {others.length > 0 && (
        <section aria-labelledby="other-accounts" className="mt-7">
          <h2 id="other-accounts" className="px-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
            Other accounts on this device
          </h2>
          <Card className="mt-2 divide-y divide-line p-1.5">
            {others.map((account) => (
              <AccountButton
                key={account.id}
                account={account}
                label={`${roleLabel(account.role)} · ${account.displayName}`}
                pending={pendingId === account.id}
                disabled={busy}
                compact
                onClick={() => void continueAs(account)}
              />
            ))}
          </Card>
        </section>
      )}

      <Link
        href="/create-account"
        className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm font-medium text-ink-muted transition-colors duration-150 hover:border-accent/40 hover:text-ink"
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        Create a sandbox account
      </Link>

      <div className="mt-8">
        <SandboxAuthNotice />
      </div>
      <p className="mt-4 px-1 text-center text-xs leading-relaxed text-ink-faint">
        TeenPay is a product preview. No real money, bank accounts, or identity
        checks are involved.
      </p>
    </div>
  );
}

function AccountButton({
  account,
  label,
  pending,
  disabled,
  compact,
  onClick,
}: {
  account: User;
  label: string;
  pending: boolean;
  disabled: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={pending || undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-3.5 text-left transition-[background-color,border-color,transform] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.99]",
        compact
          ? "rounded-xl px-3 py-2.5 hover:bg-surface-2"
          : "rounded-2xl border border-line bg-surface px-4 py-4 hover:border-accent/40 hover:bg-surface-2",
      )}
    >
      <Avatar name={account.name} initials={account.avatarInitials} size={compact ? "sm" : "md"} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium text-ink", compact ? "text-sm" : "text-[15px]")}>
          {pending ? "Opening session…" : label}
        </span>
        <span className="block truncate text-xs text-ink-muted">
          {account.name} · {formatUsername(account)}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
    </button>
  );
}
