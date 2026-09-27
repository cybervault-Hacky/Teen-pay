"use client";

import { Check, Copy, Link2, Users } from "lucide-react";
import { useState } from "react";
import { formatUsername, relationshipLabel } from "@/domain";
import { formatDateTime, formatDayLabel } from "@/lib/format";
import { findUser } from "@/sandbox/identity";
import {
  selectCurrentInvite,
  selectFamilyMembers,
  selectLink,
  selectLinkedGuardian,
  selectPendingApprovals,
  selectTeen,
} from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { TeenApprovalCard } from "./approval-cards";
import { DisconnectDialog } from "./disconnect-dialog";
import { FamilyActivity } from "./family-activity";
import { RulesSummary } from "./rules-summary";

/**
 * The teen's Family screen: connection state, who's in the family,
 * every rule that applies (no hidden restrictions), requests that
 * are waiting, and a clear way to disconnect.
 */
export function TeenFamilyView() {
  const { state, actions } = useSandbox();
  const teen = selectTeen(state);
  const link = selectLink(state, teen.id);
  const guardian = selectLinkedGuardian(state, teen.id);
  const pending = selectPendingApprovals(state, { teenId: teen.id });
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const status = link?.status ?? "not_linked";
  const lastGuardian = link?.guardianId ? findUser(state, link.guardianId) : null;
  const current = selectCurrentInvite(state, teen.id);
  const invite = current?.invite ?? null;
  const expired = current?.expired ?? false;
  const reviewer = invite?.claimedBy ? findUser(state, invite.claimedBy) : null;

  const createInvite = () => {
    const result = actions.createFamilyInvite();
    if (result.ok) {
      setError(null);
      setMessage(`Invite code ${result.value.code} is ready.`);
    } else {
      setError(result.error.message);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Code copied.");
    } catch {
      setMessage(`Code: ${code}`);
    }
  };

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>

      <section aria-labelledby="family-connection">
        <h2 id="family-connection" className="sr-only">
          Connection
        </h2>
        <Card className="p-5 sm:p-6">
          {status === "linked" && guardian ? (
            <div className="flex items-start gap-4">
              <Avatar name={guardian.name} initials={guardian.avatarInitials} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-ink">Connected</p>
                  <Badge tone="success">
                    <Check className="h-3 w-3" aria-hidden />
                    Linked
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {guardian.displayName} is connected as your parent/guardian.
                </p>
              </div>
            </div>
          ) : (status === "invitation_created" || status === "invitation_pending") &&
            invite &&
            expired ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-ink">Invite expired</p>
                <Badge tone="neutral">Expired</Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                Code {invite.code} ran out on {formatDateTime(invite.expiresAt)}. Invite
                codes last 48 hours — make a new one when your parent or guardian is ready.
              </p>
              {error && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {error}
                </p>
              )}
              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                <Button onClick={createInvite}>
                  <Link2 className="h-4 w-4" aria-hidden />
                  Create a new code
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    actions.cancelFamilyInvite();
                    setMessage("Invite removed.");
                  }}
                >
                  Remove invite
                </Button>
              </div>
            </div>
          ) : status === "invitation_created" || status === "invitation_pending" ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-ink">
                  {status === "invitation_pending" && reviewer
                    ? `${reviewer.displayName} is reviewing your invite`
                    : "Invite ready"}
                </p>
                <Badge tone="warning">
                  {status === "invitation_pending" ? "Invitation pending" : "Invitation created"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {status === "invitation_pending"
                  ? "They'll confirm the connection from their side."
                  : "Ask your parent or guardian to open Family → Add teen in their TeenPay and enter this code."}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3.5">
                <div>
                  <p className="text-xs text-ink-faint">Sandbox invite code</p>
                  <p className="mt-0.5 font-mono text-2xl font-semibold tracking-[0.08em] text-ink tabular-nums">
                    {invite?.code}
                  </p>
                  {invite && (
                    <p className="mt-0.5 text-xs text-ink-faint">
                      Expires {formatDateTime(invite.expiresAt)}
                    </p>
                  )}
                </div>
                {invite && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void copyCode(invite.code)}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    Copy code
                  </Button>
                )}
              </div>
              <p className="mt-2.5 text-xs text-ink-faint">
                Fictional sandbox code — nothing is sent anywhere, and no
                identity is verified.
              </p>
              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                <Button
                  variant="ghost"
                  onClick={() => {
                    actions.cancelFamilyInvite();
                    setMessage("Invite cancelled.");
                  }}
                >
                  Cancel invite
                </Button>
                {status === "invitation_created" && (
                  <Button variant="secondary" onClick={() => actions.switchRole("parent")}>
                    Sandbox: switch to Parent to accept
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
                <Users className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-4 text-base font-semibold text-ink">
                {status === "disconnected" ? "Parent disconnected" : "Parent not connected"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                {status === "disconnected" && lastGuardian && link?.disconnectedAt
                  ? `${lastGuardian.displayName} was disconnected on ${formatDayLabel(link.disconnectedAt)}. Your money and history are unchanged — reconnect anytime.`
                  : "Connect a parent or guardian to unlock family controls — pocket money, spending rules and approvals. You'll always see every rule they set."}
              </p>
              {error && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button className="mt-5" onClick={createInvite}>
                <Link2 className="h-4 w-4" aria-hidden />
                Connect parent
              </Button>
            </div>
          )}
        </Card>
      </section>

      {status === "linked" && (
        <section aria-label="Members">
          <SectionHeader title="Members" />
          <Card>
            <ul className="divide-y divide-line">
              {selectFamilyMembers(state).map(({ user, role, relationship }) => (
                <li key={user.id} className="flex items-center gap-3.5 px-4 py-3.5">
                  <Avatar name={user.name} initials={user.avatarInitials} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {user.displayName}
                      {user.id === teen.id && <span className="text-ink-muted"> (you)</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {role === "guardian" ? relationshipLabel(relationship) : "Teen"} ·{" "}
                      {formatUsername(user)}
                    </p>
                  </div>
                  {role === "guardian" && <Badge tone="success">Connected</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {status === "linked" && (
        <section aria-label="Your money rules">
          <SectionHeader title="Your money rules" />
          <RulesSummary teenId={teen.id} perspective="teen" />
          <p className="mt-2.5 px-1 text-xs text-ink-faint">
            These are the only rules on your money. When {guardian?.displayName ?? "your guardian"}{" "}
            changes one, you&apos;ll get a notification.
          </p>
        </section>
      )}

      {pending.length > 0 && (
        <section aria-label="Waiting for approval">
          <SectionHeader title="Waiting for approval" />
          <div className="space-y-2.5">
            {pending.map((approval) => (
              <TeenApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        </section>
      )}

      <section aria-label="Family updates">
        <SectionHeader title="Family updates" />
        <FamilyActivity />
      </section>

      {status === "linked" && guardian && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={() => setDisconnectOpen(true)}>
            Disconnect parent
          </Button>
        </div>
      )}

      <p className="px-1 text-xs leading-relaxed text-ink-faint">
        Sandbox family — fictional identities on this device. No guardian
        verification or parental consent is performed or recorded.
      </p>

      {guardian && (
        <DisconnectDialog
          open={disconnectOpen}
          onClose={() => setDisconnectOpen(false)}
          teenId={teen.id}
          otherName={guardian.displayName}
          perspective="teen"
          onDisconnected={() => setMessage(`${guardian.displayName} is no longer connected.`)}
        />
      )}
    </div>
  );
}
