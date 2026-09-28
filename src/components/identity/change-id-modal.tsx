"use client";

import { AtSign, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { normalizeTeenPayId } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

/**
 * Change your TeenPay ID — the alias only. The account behind it (and
 * every friendship, request, favourite and ledger entry, all keyed by
 * the stable internal account id) is untouched. Live feedback comes
 * from the centralized availability check: format, reserved ids and
 * uniqueness, in that order. Saving is one atomic engine transition;
 * a repeat of the current ID is a quiet no-op.
 */
export function ChangeIdModal({
  open,
  currentHandle,
  onClose,
  onSaved,
}: {
  open: boolean;
  currentHandle: string;
  onClose: () => void;
  onSaved: (handle: string) => void;
}) {
  const { actions } = useSandbox();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const availability = useMemo(() => {
    if (value.trim() === "") return null;
    const result = actions.checkTeenPayId(value);
    return result.ok ? result.value : null;
  }, [actions, value]);

  const normalized = normalizeTeenPayId(value);
  const isOwn = normalized === normalizeTeenPayId(currentHandle);
  const canSave =
    !saving && availability !== null && (availability.status === "available" || isOwn);

  const save = () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const result = actions.changeTeenPayId(value);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error.message);
      return;
    }
    setValue("");
    setSaveError(null);
    onSaved(result.value.handle);
    onClose();
  };

  const feedback = (() => {
    if (availability === null) return null;
    if (isOwn) {
      return { tone: "neutral" as const, text: "That's already your TeenPay ID." };
    }
    if (availability.status === "available") {
      return { tone: "good" as const, text: `@${availability.normalized} is available.` };
    }
    return { tone: "bad" as const, text: availability.message ?? "That ID can't be used." };
  })();

  return (
    <Modal open={open} onClose={onClose} title="Change TeenPay ID">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          Your TeenPay ID is how other teens find you. Your friendships, favourites, requests and
          history are attached to your account, so they stay exactly as they are. The ID you leave
          becomes free for someone else.
        </p>
        <Input
          label="New TeenPay ID"
          placeholder="e.g. rohan or @rohan"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaveError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          maxLength={24}
        />
        <p
          role="status"
          aria-live="polite"
          className={
            feedback
              ? feedback.tone === "good"
                ? "flex items-center gap-1.5 text-sm text-success"
                : feedback.tone === "bad"
                  ? "text-sm text-danger"
                  : "text-sm text-ink-muted"
              : "sr-only"
          }
        >
          {feedback?.tone === "good" && <Check className="h-4 w-4" aria-hidden />}
          {feedback?.text ?? ""}
        </p>
        {saveError && (
          <p role="alert" className="text-sm text-danger">
            {saveError}
          </p>
        )}
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-faint">
          <AtSign className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Letters, numbers, dots and underscores — 3 to 20 characters, starting with a letter.
        </p>
        <div className="flex gap-2.5 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Keep {currentHandle}
          </Button>
          <Button className="flex-1" disabled={!canSave} onClick={save}>
            {saving ? "Saving…" : "Save new ID"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
