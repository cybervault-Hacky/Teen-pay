"use client";

import type { Recipient } from "@/domain";
import { initialsOf } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

interface RecipientPickerProps {
  /** e.g. "Who are you paying?" */
  question: string;
  recipients: Recipient[];
  onSelect: (recipientId: string) => void;
}

/**
 * The sandbox recipient list. Fictional identities only; the
 * structure matches what a real directory would provide.
 */
export function RecipientPicker({
  question,
  recipients,
  onSelect,
}: RecipientPickerProps) {
  return (
    <div>
      <p className="mb-3 px-1 text-sm font-medium text-ink">{question}</p>
      <Card>
        <ul className="divide-y divide-line">
          {recipients.map((recipient) => (
            <li key={recipient.id}>
              <button
                type="button"
                onClick={() => onSelect(recipient.id)}
                className={cn(
                  "flex w-full items-center gap-3.5 px-5 py-3.5 text-left",
                  "transition-colors duration-150 hover:bg-surface-2",
                )}
              >
                <Avatar
                  name={recipient.name}
                  initials={initialsOf(recipient.name)}
                  size="md"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {recipient.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">
                    {recipient.handle}
                    {recipient.descriptor ? ` · ${recipient.descriptor}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-3 px-1 text-xs text-ink-faint">
        Sandbox recipients — fictional identities, no real accounts.
      </p>
    </div>
  );
}
