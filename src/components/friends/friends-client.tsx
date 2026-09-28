"use client";

import {
  ChevronRight,
  Hourglass,
  Search,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import type { FriendPreview } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { useFriendCircle } from "./use-friends";

/**
 * Friend Circles — a teen's trusted peer layer (Phase 12).
 *
 * One intentional flow: look someone up by their exact TeenPay ID,
 * see a minimal safe preview (name + handle + relationship state,
 * nothing else), then add, accept, decline or cancel. The list below
 * shows friends, incoming requests and sent requests — plain lists,
 * never a social feed. Money actions live in the existing Send /
 * Request flows (see the friend detail screen); nothing here moves
 * money, and a parent never sees this screen's data.
 */
export function FriendsClient() {
  const { actions } = useSandbox();
  const circle = useFriendCircle();
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<FriendPreview | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!circle) return null; // The route is teen-gated; parents never reach this.

  const lookup = () => {
    const result = actions.friendLookup(query);
    setError(null);
    if (!result.ok) {
      setPreview(null);
      setLookupError(result.error.message);
      return;
    }
    setLookupError(null);
    setPreview(result.value);
  };

  /** Re-runs the current lookup so the preview follows a mutation. */
  const refreshPreview = () => {
    const result = actions.friendLookup(query);
    setPreview(result.ok ? result.value : null);
    if (!result.ok) setLookupError(result.error.message);
  };

  const add = (handle: string) => {
    const result = actions.sendFriendRequest(handle);
    if (!result.ok) {
      setError(result.error.message);
      setStatus("");
      return;
    }
    setError(null);
    setStatus(`Friend request sent to ${handle}.`);
    refreshPreview();
  };

  const accept = (friendshipId: string, handle: string) => {
    const result = actions.acceptFriendRequest(friendshipId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`You and ${handle} are now friends.`);
    refreshPreview();
  };

  const decline = (friendshipId: string, handle: string) => {
    const result = actions.declineFriendRequest(friendshipId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`Request from ${handle} declined.`);
    refreshPreview();
  };

  const cancel = (friendshipId: string, handle: string) => {
    const result = actions.cancelFriendRequest(friendshipId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`Your request to ${handle} was cancelled.`);
    refreshPreview();
  };

  return (
    <>
      <PageHeader
        title="Friend Circle"
        description="Trusted teens you can send to and request from. Private to you."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />

      <div className="space-y-6">
        <section aria-label="Find someone">
          <SectionHeader title="Find someone" />
          <Card className="p-5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim()) lookup();
              }}
            >
              <label htmlFor={inputId} className="block text-sm font-medium text-ink">
                TeenPay ID
              </label>
              <p id={hintId} className="mt-1 text-xs text-ink-faint">
                Enter the exact TeenPay ID of someone you know. You&apos;ll see their name
                and ID — nothing else.
              </p>
              <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
                <div className="flex h-11 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 focus-within:border-line-strong">
                  <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                  <input
                    id={inputId}
                    type="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="@teenpay-id"
                    aria-describedby={hintId}
                    value={query}
                    onChange={(event) => setQuery(event.target.value.slice(0, 40))}
                    className="w-full min-w-0 break-all bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={query.trim() === ""}>
                  Look up
                </Button>
              </div>
            </form>

            <div className="mt-4" aria-live="polite">
              {lookupError && (
                <p role="alert" className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-muted">
                  <UserRound className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                  {lookupError}
                </p>
              )}
              {preview?.kind === "self" && (
                <div className="flex items-center gap-3.5 rounded-xl bg-surface-2 px-4 py-3.5">
                  <Avatar name={preview.profile.name} initials={preview.profile.initials} size="md" ring />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{preview.profile.name}</p>
                    <p className="truncate text-xs text-ink-muted">{preview.profile.handle}</p>
                  </div>
                  <p className="text-sm text-ink-muted">This is your TeenPay ID.</p>
                </div>
              )}
              {preview?.kind === "peer" && (
                <PreviewCard preview={preview} onAdd={add} onAccept={accept} onDecline={decline} onCancel={cancel} />
              )}
            </div>
          </Card>
        </section>

        <p role="status" aria-live="polite" className={status ? "px-1 text-sm text-ink-muted" : "sr-only"}>
          {status}
        </p>
        {error && (
          <p role="alert" className="px-1 text-sm text-danger">
            {error}
          </p>
        )}

        <section aria-label="Friend requests">
          <SectionHeader title={`Friend requests${circle.incoming.length ? ` · ${circle.incoming.length}` : ""}`} />
          <Card>
            {circle.incoming.length === 0 ? (
              <EmptyState
                className="py-10"
                icon={UserRound}
                title="No new friend requests"
                description="When someone you know sends you a request, it appears here."
              />
            ) : (
              <ul className="divide-y divide-line" aria-label="Incoming requests">
                {circle.incoming.map((request) => (
                  <li key={request.friendshipId} className="flex items-center gap-3.5 px-5 py-3.5">
                    <Avatar name={request.name} initials={request.initials} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{request.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-muted">{request.handle}</span>
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => accept(request.friendshipId, request.handle)} aria-label={`Accept ${request.handle}`}>
                        Accept
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => decline(request.friendshipId, request.handle)} aria-label={`Decline ${request.handle}`}>
                        Decline
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section aria-label="Sent requests">
          <SectionHeader title="Sent requests" />
          <Card>
            {circle.outgoing.length === 0 ? (
              <EmptyState
                className="py-10"
                icon={Hourglass}
                title="No pending requests"
                description="Requests you send stay here until they're answered."
              />
            ) : (
              <ul className="divide-y divide-line" aria-label="Sent requests">
                {circle.outgoing.map((request) => (
                  <li key={request.friendshipId} className="flex items-center gap-3.5 px-5 py-3.5">
                    <Avatar name={request.name} initials={request.initials} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{request.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-muted">{request.handle}</span>
                    </span>
                    <Badge tone="warning">
                      <Hourglass className="h-3 w-3" aria-hidden />
                      Pending
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => cancel(request.friendshipId, request.handle)} aria-label={`Cancel request to ${request.handle}`}>
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section aria-label="Friends">
          <SectionHeader title={`Friends${circle.friends.length ? ` · ${circle.friends.length}` : ""}`} />
          <Card>
            {circle.friends.length === 0 ? (
              <EmptyState
                className="py-10"
                icon={Users}
                title="Your trusted circle is empty"
                description="Add someone you know by their TeenPay ID."
              />
            ) : (
              <ul className="divide-y divide-line" aria-label="Friends">
                {circle.friends.map((friend) => (
                  <li key={friend.friendshipId}>
                    <Link
                      href={`/friends/${encodeURIComponent(friend.handle.replace(/^@/, ""))}`}
                      className="flex items-center gap-3.5 px-5 py-3.5 transition-colors duration-150 hover:bg-surface-2"
                    >
                      <Avatar name={friend.name} initials={friend.initials} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{friend.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">{friend.handle}</span>
                      </span>
                      <Badge tone="success">
                        <UserCheck className="h-3 w-3" aria-hidden />
                        Friends
                      </Badge>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="mt-3 px-1 text-xs leading-relaxed text-ink-faint">
            Friends never see your balance, Spaces, goals or history. A friendship only
            makes sending and requesting easier — every payment still follows your rules.
          </p>
        </section>
      </div>
    </>
  );
}

/** The safe preview card: public profile + relationship state + the one fitting action. */
function PreviewCard({
  preview,
  onAdd,
  onAccept,
  onDecline,
  onCancel,
}: {
  preview: Extract<FriendPreview, { kind: "peer" }>;
  onAdd: (handle: string) => void;
  onAccept: (friendshipId: string, handle: string) => void;
  onDecline: (friendshipId: string, handle: string) => void;
  onCancel: (friendshipId: string, handle: string) => void;
}) {
  const { profile, relation } = preview;
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-4">
      <div className="flex items-center gap-3.5">
        <Avatar name={profile.name} initials={profile.initials} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{profile.name}</p>
          <p className="truncate text-xs text-ink-muted">{profile.handle}</p>
        </div>
        <RelationBadge relation={relation.kind} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2.5">
        {relation.kind === "none" && (
          <Button size="sm" onClick={() => onAdd(profile.handle)}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Add Friend
          </Button>
        )}
        {relation.kind === "request_sent" && (
          <Button size="sm" variant="secondary" onClick={() => onCancel(relation.friendshipId, profile.handle)}>
            <X className="h-4 w-4" aria-hidden />
            Cancel request
          </Button>
        )}
        {relation.kind === "request_received" && (
          <>
            <Button size="sm" onClick={() => onAccept(relation.friendshipId, profile.handle)}>
              <UserCheck className="h-4 w-4" aria-hidden />
              Accept
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDecline(relation.friendshipId, profile.handle)}>
              Decline
            </Button>
          </>
        )}
        {relation.kind === "friends" && (
          <Button size="sm" variant="secondary" href={`/friends/${encodeURIComponent(profile.handle.replace(/^@/, ""))}`}>
            View friend
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function RelationBadge({
  relation,
}: {
  relation: "none" | "friends" | "request_sent" | "request_received";
}) {
  switch (relation) {
    case "friends":
      return (
        <Badge tone="success">
          <UserCheck className="h-3 w-3" aria-hidden />
          Friends
        </Badge>
      );
    case "request_sent":
      return (
        <Badge tone="warning">
          <Hourglass className="h-3 w-3" aria-hidden />
          Request pending
        </Badge>
      );
    case "request_received":
      return (
        <Badge tone="accent">
          <UserRound className="h-3 w-3" aria-hidden />
          Request received
        </Badge>
      );
    default:
      return <Badge tone="neutral">Not connected</Badge>;
  }
}
