"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  SearchX,
  Send,
  Star,
  UserRoundPlus,
  UserRoundX,
  Users,
} from "lucide-react";
import { useState } from "react";
import { isValidTeenPayIdFormat, looksLikeInternalId } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCard } from "./identity-card";

const relationCopy = {
  friends: { label: "Friend", tone: "success" },
  request_sent: { label: "Request sent", tone: "warning" },
  request_received: { label: "Request received", tone: "accent" },
  none: { label: "Not connected", tone: "neutral" },
} as const;

/**
 * One TeenPay ID, one surface — where search, the QR scanner and the
 * Friend Circle all land. Shows exactly the safe identity projection
 * (name, handle, initials, the viewer's own relationship and action
 * state) and opens the existing Send / Request / favourite / friend
 * actions. Never renders an internal id, and never anything financial.
 */
export function IdentityDetail({ teenPayId }: { teenPayId: string }) {
  const { actions } = useSandbox();
  const [status, setStatus] = useState("");

  // Route params are untrusted input: only a well-formed, normalized
  // TeenPay ID ever reaches the lookup — and nothing shaped like an
  // internal record id (`usr_…`) is ever interpreted as one.
  if (!isValidTeenPayIdFormat(teenPayId) || looksLikeInternalId(teenPayId)) {
    return (
      <>
        <PageHeader title="TeenPay ID" />
        <Card>
          <EmptyState
            className="py-10"
            icon={SearchX}
            title="That doesn't look like a TeenPay ID"
            description="TeenPay IDs use 3–20 lowercase letters, numbers, dots or underscores, starting with a letter."
          />
        </Card>
      </>
    );
  }

  const result = actions.identitySearch(teenPayId);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="TeenPay ID" />
        <Card>
          <EmptyState
            className="py-10"
            icon={SearchX}
            title={result.error.message}
            description="Check the ID and try again. IDs that don't belong to an active teen are never shown."
          />
        </Card>
      </>
    );
  }

  const identity = result.value;

  // Your own ID: the identity card with copy, share and change.
  if (identity.self) {
    return (
      <>
        <PageHeader title="Your TeenPay ID" description="This is what other teens see — nothing more." />
        <IdentityCard
          name={identity.profile.name}
          initials={identity.profile.initials}
          handle={identity.profile.handle}
          showQrLink
        />
      </>
    );
  }

  const { profile, relation, favourite } = identity;
  const username = profile.handle.slice(1);
  const badge = relationCopy[relation?.kind ?? "none"];
  const isFriend = relation?.kind === "friends";
  const via = isFriend ? "&via=friend" : "";

  const toggleFavourite = () => {
    const outcome = favourite ? actions.removeContact(username) : actions.addContact(username);
    if (!outcome.ok) {
      setStatus(outcome.error.message);
      return;
    }
    setStatus(
      favourite
        ? `Removed ${profile.handle} from your favourites.`
        : `Added ${profile.handle} to your favourites.`,
    );
  };

  const sendFriendRequest = () => {
    const outcome = actions.sendFriendRequest(username);
    if (!outcome.ok) {
      setStatus(outcome.error.message);
      return;
    }
    setStatus(`Friend request sent to ${profile.handle}.`);
  };

  const cancelFriendRequest = () => {
    if (relation?.kind !== "request_sent") return;
    const outcome = actions.cancelFriendRequest(relation.friendshipId);
    if (!outcome.ok) {
      setStatus(outcome.error.message);
      return;
    }
    setStatus(`Your request to ${profile.handle} was cancelled.`);
  };

  return (
    <>
      <PageHeader title={profile.name} description="Their public identity — nothing more is shared." />

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <Avatar name={profile.name} initials={profile.initials} size="lg" ring />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-ink">{profile.name}</p>
            <p className="truncate text-sm text-ink-muted">{profile.handle}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={badge.tone}>{badge.label}</Badge>
              {favourite && (
                <Badge tone="neutral">
                  <Star className="h-3 w-3" aria-hidden />
                  Favourite
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <Button href={`/send?to=${username}${via}`}>
            <ArrowUpFromLine className="h-4 w-4" aria-hidden />
            Send Money
          </Button>
          <Button variant="secondary" href={`/request?to=${username}${via}`}>
            <ArrowDownToLine className="h-4 w-4" aria-hidden />
            Request Money
          </Button>
          <Button variant="secondary" onClick={toggleFavourite}>
            <Star className="h-4 w-4" aria-hidden />
            {favourite ? "Remove favourite" : "Add favourite"}
          </Button>
          {relation?.kind === "none" && (
            <Button variant="secondary" onClick={sendFriendRequest}>
              <UserRoundPlus className="h-4 w-4" aria-hidden />
              Add friend
            </Button>
          )}
          {relation?.kind === "request_sent" && (
            <Button variant="secondary" onClick={cancelFriendRequest}>
              <UserRoundX className="h-4 w-4" aria-hidden />
              Cancel request
            </Button>
          )}
          {relation?.kind === "request_received" && (
            <Button variant="secondary" href="/friends">
              <Users className="h-4 w-4" aria-hidden />
              Respond in Friend Circle
            </Button>
          )}
          {relation?.kind === "friends" && (
            <Button variant="secondary" href={`/friends/${username}`}>
              <Users className="h-4 w-4" aria-hidden />
              View in Friend Circle
            </Button>
          )}
        </div>

        <p
          role="status"
          aria-live="polite"
          className={status ? "mt-4 text-sm text-ink-muted" : "sr-only"}
        >
          {status || " "}
        </p>

        <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3.5 text-xs leading-relaxed text-ink-faint">
          <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Money always goes through the normal Send / Request flow with your guardian&apos;s rules —
          being connected here never moves anything by itself.
        </p>
      </Card>
    </>
  );
}
