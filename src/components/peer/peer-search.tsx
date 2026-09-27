"use client";

import { Search, UserRound } from "lucide-react";
import { useId, useState } from "react";
import type { PeerProfile } from "@/domain";
import { cn } from "@/lib/cn";
import { PEER_SEARCH_MIN } from "@/sandbox/peer";
import { useSandbox } from "@/sandbox/store";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

interface PeerSearchProps {
  /** e.g. "Who are you sending to?" */
  question: string;
  onSelect: (profile: PeerProfile) => void;
}

/**
 * Finds another TeenPay teen by TeenPay ID (@meera) or name. Results
 * come from the store's peer directory: eligible accounts only, and
 * only what's safe to show — @handle, name, initials. No account,
 * wallet or family details ever reach this screen.
 */
export function PeerSearch({ question, onSelect }: PeerSearchProps) {
  const { peers } = useSandbox();
  const [query, setQuery] = useState("");
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const trimmed = query.trim().replace(/^@+/, "");
  const searching = trimmed.length >= PEER_SEARCH_MIN;
  const results = searching ? peers.search(query) : [];

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block px-1 text-sm font-medium text-ink">
        {question}
      </label>
      <div className="flex h-12 items-center gap-2.5 rounded-2xl border border-line bg-surface-2 px-4 focus-within:border-line-strong">
        <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        <input
          id={inputId}
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="@teenpay-id or name"
          aria-describedby={hintId}
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 60))}
          className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
      <p id={hintId} className="mt-2 px-1 text-xs text-ink-faint">
        TeenPay teens only. You&apos;ll see their TeenPay ID and name — nothing else.
      </p>

      <div className="mt-4" aria-live="polite">
        {searching && results.length === 0 && (
          <Card className="flex items-center gap-3 px-5 py-4">
            <UserRound className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
            <p className="text-sm text-ink-muted">No TeenPay user found.</p>
          </Card>
        )}
        {results.length > 0 && (
          <Card>
            <ul className="divide-y divide-line" aria-label="TeenPay users">
              {results.map((profile) => (
                <li key={profile.handle}>
                  <button
                    type="button"
                    onClick={() => onSelect(profile)}
                    className={cn(
                      "flex w-full items-center gap-3.5 px-5 py-3.5 text-left",
                      "transition-colors duration-150 hover:bg-surface-2",
                    )}
                  >
                    <Avatar name={profile.name} initials={profile.initials} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{profile.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-muted">{profile.handle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
