"use client";

import { Check, UserPlus } from "lucide-react";
import { useState } from "react";
import { formatUsername, normalizeInviteCode, type User } from "@/domain";
import { findUser } from "@/sandbox/identity";
import { selectClaimedInvite, selectSession, selectTeensOf } from "@/sandbox/selectors";
import { useSandbox, useSandboxData } from "@/sandbox/store";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { DisconnectDialog } from "./disconnect-dialog";
import { FamilyActivity } from "./family-activity";

/**
 * The guardian's Family screen: add a teen with their sandbox
 * invite code (enter → review → connect), see who's connected,
 * and disconnect safely.
 */
export function ParentFamilyView() {
  const { state, actions } = useSandbox();
  const { user: me } = selectSession(state);
  const teens = selectTeensOf(state, me.id);
  const [message, setMessage] = useState("");
  const [disconnecting, setDisconnecting] = useState<User | null>(null);

  // A review in progress is real state (invitation_pending), so it
  // survives refreshes and role switches.
  const claimed = selectClaimedInvite(state, me.id);
  const reviewLink = claimed
    ? state.family.links.find(
        (l) => l.status === "invitation_pending" && l.teenId === claimed.teenId,
      )
    : undefined;
  const reviewTeen = reviewLink ? findUser(state, reviewLink.teenId) : null;

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>

      {teens.length > 0 && (
        <section aria-label="Connected teens">
          <SectionHeader title="Connected" />
          <Card>
            <ul className="divide-y divide-line">
              <li className="flex items-center gap-3.5 px-4 py-3.5">
                <Avatar name={me.name} initials={me.avatarInitials} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {me.displayName} <span className="text-ink-muted">(you)</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    Parent / Guardian · {formatUsername(me)}
                  </p>
                </div>
              </li>
              {teens.map((teen) => (
                <li key={teen.id} className="flex flex-wrap items-center gap-3.5 px-4 py-3.5">
                  <Avatar name={teen.name} initials={teen.avatarInitials} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{teen.displayName}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      Teen · {formatUsername(teen)}
                    </p>
                  </div>
                  <Badge tone="success">
                    <Check className="h-3 w-3" aria-hidden />
                    Connected
                  </Badge>
                  <div className="flex w-full gap-2 sm:w-auto">
                    <Button variant="secondary" size="sm" href="/parent" className="flex-1 sm:flex-none">
                      Overview
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 sm:flex-none"
                      onClick={() => setDisconnecting(teen)}
                    >
                      Disconnect
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {reviewLink && reviewTeen ? (
        <ReviewTeen
          teen={reviewTeen}
          onConnect={() => {
            const result = actions.acceptFamilyInvite(reviewTeen.id);
            if (result.ok) setMessage(`Connected with ${reviewTeen.displayName}.`);
            return result.ok ? null : result.error.message;
          }}
          onCancel={() => {
            actions.releaseFamilyInvite(reviewTeen.id);
            setMessage("Review closed. The invite is still open.");
          }}
        />
      ) : (
        teens.length === 0 && (
          <AddTeen
            onFound={(teen) => setMessage(`Found ${teen.displayName}. Review before connecting.`)}
          />
        )
      )}

      <section aria-label="Family updates">
        <SectionHeader title="Family updates" />
        <FamilyActivity />
      </section>

      <p className="px-1 text-xs leading-relaxed text-ink-faint">
        Sandbox family — fictional identities on this device. Connecting
        does not verify anyone&apos;s identity or guardianship, and no legal
        parental consent is recorded.
      </p>

      {disconnecting && (
        <DisconnectDialog
          open
          onClose={() => setDisconnecting(null)}
          teenId={disconnecting.id}
          otherName={disconnecting.displayName}
          perspective="guardian"
          onDisconnected={() =>
            setMessage(`You're no longer connected with ${disconnecting.displayName}.`)
          }
        />
      )}
    </div>
  );
}

function AddTeen({ onFound }: { onFound: (teen: User) => void }) {
  const { actions } = useSandbox();
  const { findAccount } = useSandboxData();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      setError("Enter the invite code from your teen.");
      return;
    }
    const result = actions.claimFamilyInvite(normalizeInviteCode(code));
    if (result.ok) {
      // Look the teen up after the claim: before it, an unlinked
      // parent's scope doesn't include them.
      const teen = findAccount(result.value.teenId);
      if (teen) onFound(teen);
      setCode("");
      setError(undefined);
    } else {
      setError(result.error.message);
    }
  };

  return (
    <section aria-label="Add teen">
      <SectionHeader title="Add teen" />
      <Card className="p-5 sm:p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
          <UserPlus className="h-5 w-5" aria-hidden />
        </span>
        <p className="mt-4 text-base font-semibold text-ink">No teen connected yet</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Your teen creates an invite code in Profile → Family. Enter it here
          to connect.
        </p>
        <form onSubmit={submit} className="mt-5" noValidate>
          <Input
            label="Invite code"
            placeholder="TEEN-0000"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError(undefined);
            }}
            error={error}
            hint="Sandbox codes look like TEEN-4821."
            maxLength={12}
          />
          <Button type="submit" className="mt-4 w-full sm:w-auto">
            Find teen
          </Button>
        </form>
      </Card>
    </section>
  );
}

function ReviewTeen({
  teen,
  onConnect,
  onCancel,
}: {
  teen: User;
  onConnect: () => string | null;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Review teen">
      <SectionHeader title="Review teen" />
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <Avatar name={teen.name} initials={teen.avatarInitials} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">{teen.name}</p>
            <p className="text-sm text-ink-muted">{formatUsername(teen)}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge>Teen</Badge>
              <Badge tone="warning">Sandbox identity · not verified</Badge>
            </div>
          </div>
        </div>
        <p className="mt-5 text-sm font-medium text-ink">What connecting means</p>
        <ul className="mt-2 space-y-2 text-sm text-ink-muted">
          <li>· You can send pocket money and set a schedule.</li>
          <li>· You can set spending limits and approval rules.</li>
          <li>· You&apos;ll see {teen.displayName}&apos;s balance and recent activity.</li>
          <li>· {teen.displayName} sees every rule you set.</li>
        </ul>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Not now
          </Button>
          <Button
            className="flex-1"
            onClick={() => setError(onConnect())}
          >
            Connect
          </Button>
        </div>
      </Card>
    </section>
  );
}
