"use client";

import { Check, QrCode, Star, UserPlus, X } from "lucide-react";
import { useState } from "react";
import type { PeerProfile } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { PeerSearch } from "@/components/peer/peer-search";
import { FavouritesList } from "./favourites-list";

/**
 * Favourites: find someone (search → their public profile → Add), or
 * scan their QR; pay or request from the list in one tap (into the
 * existing flows, which still confirm); remove. Only the viewer sees
 * their list. Every row is the person's current public profile.
 */
export function FavouritesClient() {
  const { actions, contacts } = useSandbox();
  const [adding, setAdding] = useState(false);
  const [candidate, setCandidate] = useState<PeerProfile | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!candidate) return;
    const result = actions.addContact(candidate.handle);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(`${candidate.handle} added to favourites.`);
    setCandidate(null);
    setAdding(false);
  };

  const remove = (handle: string) => {
    const result = actions.removeContact(handle);
    setError(result.ok ? null : result.error.message);
    setStatus(result.ok ? `${handle} removed from favourites. Past payments and requests aren't affected.` : "");
  };

  const closeAdd = () => {
    setAdding(false);
    setCandidate(null);
    setError(null);
  };

  const alreadySaved = candidate ? contacts.isFavourite(candidate.handle) : false;

  return (
    <>
      <PageHeader
        title="Favourites"
        description="People you pay often. Only you can see this list."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" onClick={() => (adding ? closeAdd() : setAdding(true))} aria-expanded={adding}>
            {adding ? <X className="h-4 w-4" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
            {adding ? "Close" : "Add a favourite"}
          </Button>
          <Button variant="secondary" href="/qr/scan">
            <QrCode className="h-4 w-4" aria-hidden />
            Scan a QR
          </Button>
        </div>

        {adding && (
          <section aria-label="Add a favourite">
            {candidate ? (
              <Card className="p-5">
                <div className="flex items-center gap-3.5">
                  <Avatar name={candidate.name} initials={candidate.initials} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-ink">{candidate.name}</p>
                    <p className="truncate text-sm text-ink-muted">{candidate.handle}</p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2.5">
                  <Button variant="secondary" className="flex-1" onClick={() => setCandidate(null)}>
                    Back
                  </Button>
                  <Button className="flex-1" onClick={add} disabled={alreadySaved}>
                    {alreadySaved ? <Check className="h-4 w-4" aria-hidden /> : <Star className="h-4 w-4" aria-hidden />}
                    {alreadySaved ? "In favourites" : "Add to favourites"}
                  </Button>
                </div>
              </Card>
            ) : (
              <PeerSearch question="Who do you want to add?" onSelect={setCandidate} />
            )}
          </section>
        )}

        <p role="status" aria-live="polite" className={status ? "px-1 text-sm text-ink-muted" : "sr-only"}>
          {status}
        </p>
        {error && (
          <p role="alert" className="px-1 text-sm text-danger">
            {error}
          </p>
        )}

        <section aria-label="Your favourites">
          <SectionHeader title={`Your favourites${contacts.list.length ? ` · ${contacts.list.length}` : ""}`} />
          <Card>
            {contacts.list.length === 0 ? (
              <EmptyState
                className="py-10"
                icon={Star}
                title="No favourites yet"
                description="Add people you pay often — from search, or by scanning their TeenPay QR."
              />
            ) : (
              <FavouritesList contacts={contacts.list} onRemove={(c) => remove(c.handle)} />
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
