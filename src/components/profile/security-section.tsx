"use client";

import { Clock, KeyRound, LogOut, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { useOptionalAuth } from "@/auth/provider";
import { describeSecurityEvent } from "@/domain";
import { formatDateTime } from "@/lib/format";
import { useSandbox, useSandboxData } from "@/sandbox/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list-row";
import { Modal } from "@/components/ui/modal";
import { SectionHeader } from "@/components/ui/section-header";

/**
 * Profile → Security: the active session, sign out, an honest
 * security status, recent account events, and the deletion-request
 * placeholder. Nothing here claims verification that doesn't exist.
 */
export function SecuritySection() {
  const auth = useOptionalAuth();
  const { viewer } = useSandbox();
  const data = useSandboxData();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [message, setMessage] = useState("");

  const session = auth?.status === "authenticated" ? auth.session : null;
  const account = data.findAccount(viewer.id) ?? viewer;
  const events = data.securityEvents(viewer.id).slice(0, 5);

  // The auth gate takes a deliberate sign-out straight to /sign-in.
  const signOut = () => auth?.signOut("user");

  const requestDeletion = () => {
    const result = data.requestAccountDeletion(viewer.id);
    setDeleteOpen(false);
    setMessage(
      result.ok
        ? "Deletion request recorded. Nothing has been deleted."
        : result.error.message,
    );
  };

  return (
    <section aria-label="Security">
      <SectionHeader title="Security" />
      <Card className="divide-y divide-line p-2">
        <ListRow
          icon={KeyRound}
          title="Active session"
          subtitle={
            session
              ? `Sandbox session · started ${formatDateTime(session.createdAt)}`
              : "No session layer in this view"
          }
          right={session ? <Badge tone="warning">Sandbox</Badge> : undefined}
        />
        {session && (
          <ListRow
            icon={Clock}
            title="Session ends"
            subtitle={`${formatDateTime(session.expiresAt)} — then you'll sign in again`}
          />
        )}
        <ListRow
          icon={ShieldAlert}
          title="Security status"
          subtitle="Not verified — sandbox accounts have no password, no ID checks and no real money"
        />
      </Card>

      {session && (
        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
          <Button variant="secondary" className="sm:flex-1" onClick={signOut}>
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </Button>
          <Button
            variant="ghost"
            className="sm:flex-1"
            onClick={() => auth?.expireSession()}
          >
            <Clock className="h-4 w-4" aria-hidden />
            Sandbox: expire session now
          </Button>
        </div>
      )}
      {session && (
        <p className="mt-2 px-1 text-xs text-ink-faint">
          Signing out ends this session only — your sandbox data stays on this device.
        </p>
      )}

      {events.length > 0 && (
        <Card className="mt-3 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Recent account activity
          </h3>
          <ul className="mt-2.5 space-y-2">
            {events.map((event) => (
              <li key={event.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink">{describeSecurityEvent(event.type)}</span>
                <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                  {formatDateTime(event.at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-3 divide-y divide-line p-2">
        {account.deletionRequestedAt ? (
          <ListRow
            icon={Trash2}
            title="Deletion requested"
            subtitle={`Requested ${formatDateTime(account.deletionRequestedAt)} · nothing has been deleted`}
            right={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  data.cancelAccountDeletion(viewer.id);
                  setMessage("Deletion request withdrawn.");
                }}
              >
                Withdraw
              </Button>
            }
          />
        ) : (
          <ListRow
            icon={Trash2}
            title="Request account deletion"
            subtitle="Placeholder — records a request, deletes nothing"
            right={
              <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
                Request
              </Button>
            }
          />
        )}
      </Card>
      <p role="status" aria-live="polite" className="mt-2 min-h-4 px-1 text-xs text-ink-muted">
        {message}
      </p>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Request account deletion?"
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          In the sandbox this only records your request. Nothing is deleted
          now, and money history is never erased by a deletion request — a
          real service would review it and keep the records the law requires.
        </p>
        <div className="mt-5 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" onClick={requestDeletion}>
            Record request
          </Button>
        </div>
      </Modal>
    </section>
  );
}
