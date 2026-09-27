"use client";

import { ArrowDownLeft, Send, X } from "lucide-react";
import type { ContactView } from "@/sandbox/contacts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

function flowHref(path: "/send" | "/request", handle: string): string {
  return `${path}?to=${encodeURIComponent(handle.replace(/^@/, ""))}&via=favourite`;
}

/**
 * Favourites as compact rows: who (public profile only) and what you
 * can do — Pay and Request open the existing flows with the person
 * preselected (still amount → review → confirm; the engine re-checks
 * then). Someone who can't take part any more shows as "Not available
 * right now" in words, not just colour; their actions stay reachable
 * so the flow — not this list — makes the call, and it says no.
 */
export function FavouritesList({
  contacts,
  onRemove,
}: {
  contacts: ContactView[];
  /** When given, each row gets a Remove button. */
  onRemove?: (contact: ContactView) => void;
}) {
  return (
    <ul className="divide-y divide-line" aria-label="Favourites">
      {contacts.map((contact) => (
        <li key={contact.handle} className="flex items-center gap-3 px-4 py-3">
          <Avatar name={contact.name} initials={contact.initials} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {contact.available ? contact.name : contact.handle}
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {contact.available ? contact.handle : "Not available right now"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              href={flowHref("/send", contact.handle)}
              aria-label={`Pay ${contact.handle}`}
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              Pay
            </Button>
            <Button
              variant="ghost"
              size="sm"
              href={flowHref("/request", contact.handle)}
              aria-label={`Request from ${contact.handle}`}
            >
              <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Request</span>
            </Button>
            {onRemove && (
              <IconButton
                variant="ghost"
                size="sm"
                label={`Remove ${contact.handle} from favourites`}
                onClick={() => onRemove(contact)}
              >
                <X className="h-4 w-4" aria-hidden />
              </IconButton>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
