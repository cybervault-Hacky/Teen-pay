"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  Hourglass,
  Send,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserRound,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSandbox } from "@/sandbox/store";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";

/**
 * One peer in the Friend Circle, by TeenPay ID. Shows only what the
 * directory already makes public — name, handle, initials — plus the
 * viewer's own relationship state. For a friend: the existing Send /
 * Request flows (opened with the recipient preselected; the engine
 * re-checks every rule at confirm) and Remove friend. Nothing here
 * moves money or reveals anything private.
 */
export function FriendDetail({ teenPayId }: { teenPayId: string }) {
  const { actions } = useSandbox();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A mutation changes the database, so re-reading gives fresh state.
  const lookup = actions.friendLookup(teenPayId);

  const friendHref = `/send?to=${encodeURIComponent(teenPayId.replace(/^@/, ""))}&via=friend`;
  const requestHref = `/request?to=${encodeURIComponent(teenPayId.replace(/^@/, ""))}&via=friend`;

  if (!lookup.ok) {
    return (
      <div className="mx-auto max-w-sm">
        <BackLink />
        <Card className="mt-4 p-6 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-muted">
            <UserRound className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">No TeenPay user found</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{lookup.error.message}</p>
        </Card>
      </div>
    );
  }

  if (lookup.value.kind === "self") {
    return (
      <div className="mx-auto max-w-sm">
        <BackLink />
        <Card className="mt-4 p-6 text-center">
          <Avatar name={lookup.value.profile.name} initials={lookup.value.profile.initials} size="lg" ring className="mx-auto" />
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">This is your TeenPay ID.</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Share it — or your QR — so people you know can find you.
          </p>
        </Card>
      </div>
    );
  }

  const { profile, relation } = lookup.value;

  const add = () => {
    const result = actions.sendFriendRequest(profile.handle);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`Friend request sent to ${profile.handle}.`);
  };

  const accept = () => {
    if (relation.kind !== "request_received") return;
    const result = actions.acceptFriendRequest(relation.friendshipId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`You and ${profile.handle} are now friends.`);
  };

  const decline = () => {
    if (relation.kind !== "request_received") return;
    const result = actions.declineFriendRequest(relation.friendshipId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`Request from ${profile.handle} declined.`);
  };

  const cancel = () => {
    if (relation.kind !== "request_sent") return;
    const result = actions.cancelFriendRequest(relation.friendshipId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`Your request to ${profile.handle} was cancelled.`);
  };

  const remove = () => {
    const result = actions.removeFriend(profile.handle);
    setConfirmOpen(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`${profile.handle} removed from your Friend Circle. Your history and rules are unchanged.`);
  };

  return (
    <div className="mx-auto max-w-sm">
      <BackLink />

      <Card className="mt-4 p-6">
        <div className="flex flex-col items-center text-center">
          <Avatar name={profile.name} initials={profile.initials} size="lg" />
          <h1 className="mt-4 break-words text-xl font-semibold tracking-tight text-ink">{profile.name}</h1>
          <p className="mt-1 break-all text-sm text-ink-muted">{profile.handle}</p>
          <div className="mt-3">
            {relation.kind === "friends" && (
              <Badge tone="success">
                <UserCheck className="h-3 w-3" aria-hidden />
                Friends
              </Badge>
            )}
            {relation.kind === "request_sent" && (
              <Badge tone="warning">
                <Hourglass className="h-3 w-3" aria-hidden />
                Request pending
              </Badge>
            )}
            {relation.kind === "request_received" && (
              <Badge tone="accent">
                <UserRound className="h-3 w-3" aria-hidden />
                Request received
              </Badge>
            )}
            {relation.kind === "none" && <Badge tone="neutral">Not connected</Badge>}
          </div>
        </div>

        <div className="mt-6 space-y-2.5">
          {relation.kind === "friends" && (
            <>
              <Button fullWidth href={friendHref}>
                <Send className="h-4 w-4" aria-hidden />
                Send Money
              </Button>
              <Button fullWidth variant="secondary" href={requestHref}>
                <ArrowDownLeft className="h-4 w-4" aria-hidden />
                Request Money
              </Button>
              <Button fullWidth variant="danger" onClick={() => setConfirmOpen(true)}>
                <UserX className="h-4 w-4" aria-hidden />
                Remove friend
              </Button>
            </>
          )}
          {relation.kind === "none" && (
            <Button fullWidth onClick={add}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Add Friend
            </Button>
          )}
          {relation.kind === "request_sent" && (
            <Button fullWidth variant="secondary" onClick={cancel}>
              <Hourglass className="h-4 w-4" aria-hidden />
              Cancel request
            </Button>
          )}
          {relation.kind === "request_received" && (
            <>
              <Button fullWidth onClick={accept}>
                <UserCheck className="h-4 w-4" aria-hidden />
                Accept request
              </Button>
              <Button fullWidth variant="secondary" onClick={decline}>
                Decline
              </Button>
            </>
          )}
        </div>

        <p role="status" aria-live="polite" className={status ? "mt-4 text-center text-sm text-ink-muted" : "sr-only"}>
          {status}
        </p>
        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-danger">
            {error}
          </p>
        )}

        <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Friends never see your balance, Spaces, goals or history. Payments still follow
          your guardian rules and available balance.
        </p>
      </Card>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Remove ${profile.handle}?`}>
        <p className="text-sm leading-relaxed text-ink-muted">
          They&apos;ll leave your Friend Circle. Past payments and requests stay in your
          history, and you can send a new friend request later.
        </p>
        <div className="mt-5 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmOpen(false)}>
            Keep friend
          </Button>
          <Button variant="danger" className="flex-1" onClick={remove}>
            Remove friend
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/friends"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Friend Circle
    </Link>
  );
}
