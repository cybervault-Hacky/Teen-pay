"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  productDay,
  SPACE_ICONS,
  SPACE_NAME_MAX,
  validateSpaceDraft,
  type SpaceFieldErrors,
  type SpaceIcon,
  type SpaceType,
} from "@/domain";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/currency";
import { makeId } from "@/lib/ids";
import { amountError } from "@/sandbox/engine";
import { selectActiveSpaces, type SpaceView } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SPACE_ICON_COMPONENTS, SPACE_ICON_LABELS } from "./space-parts";

type FormErrors = SpaceFieldErrors & { startingAmount?: string; form?: string };

interface SpaceFormSheetProps {
  open: boolean;
  onClose: () => void;
  /** Editing an existing Space; omitted to create one. */
  space?: SpaceView | null;
  /** The type to start a new Space with. */
  initialType?: "goal" | "custom";
  /** Derived available balance (for the optional starting amount). */
  available: number;
  onSaved?: (spaceId: string, summary: string) => void;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 6);

/**
 * Create or edit a Money Space. Validation is the domain's
 * (`validateSpaceDraft`), shown inline per field; the store runs the
 * same checks again, and its field-tagged errors land on the field.
 * One idempotency key per opening, so a double submit creates one
 * Space.
 */
export function SpaceFormSheet({
  open,
  onClose,
  space,
  initialType = "goal",
  available,
  onSaved,
}: SpaceFormSheetProps) {
  const { state, actions } = useSandbox();
  const editing = Boolean(space);
  const formId = useId();
  const [type, setType] = useState<SpaceType>(space?.type ?? initialType);
  const [name, setName] = useState(space?.name ?? "");
  const [icon, setIcon] = useState<SpaceIcon>(space?.icon ?? "target");
  const [target, setTarget] = useState(space?.targetAmount ? String(space.targetAmount) : "");
  const [deadline, setDeadline] = useState(space?.deadline ?? "");
  const [starting, setStarting] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrors>({});
  const [intentId, setIntentId] = useState(() => makeId("spc"));
  const busy = useRef(false);
  // Reset only when the sheet opens (or targets another Space) — not
  // whenever unrelated state changes produce a fresh Space object.
  const spaceRef = useRef(space);
  spaceRef.current = space;
  const spaceKey = space?.id ?? null;

  useEffect(() => {
    if (!open) return;
    const space = spaceRef.current;
    setType(space?.type ?? initialType);
    setName(space?.name ?? "");
    setIcon(space?.icon ?? (initialType === "goal" ? "target" : "piggy-bank"));
    setTarget(space?.targetAmount ? String(space.targetAmount) : "");
    setDeadline(space?.deadline ?? "");
    setStarting("");
    setSubmitted(false);
    setServerErrors({});
    setIntentId(makeId("spc"));
    busy.current = false;
  }, [open, spaceKey, initialType]);

  const today = productDay(new Date().toISOString());
  const targetAmount = target ? Number(target) : null;
  const startingAmount = starting ? Number(starting) : 0;

  const fieldErrors: FormErrors = validateSpaceDraft(
    {
      name,
      type,
      icon,
      targetAmount,
      deadline: type === "goal" && deadline ? deadline : null,
    },
    {
      otherActiveNames: selectActiveSpaces(state)
        .filter((s) => s.id !== space?.id)
        .map((s) => s.name),
      today,
      currentBalance: space?.balance ?? 0,
      previousDeadline: space?.deadline,
    },
  );
  if (!editing && starting) {
    const problem =
      amountError(startingAmount)?.message ??
      (startingAmount > available
        ? `You have ${formatINR(available)} available.`
        : type === "goal" && targetAmount && startingAmount > targetAmount
          ? "The starting amount can't be more than the target."
          : undefined);
    if (problem) fieldErrors.startingAmount = problem;
  }
  const hasErrors = Object.keys(fieldErrors).length > 0;
  const errors: FormErrors = { ...(submitted ? fieldErrors : {}), ...serverErrors };
  // Some problems are worth showing as soon as they appear.
  if (!submitted) {
    if (name.trim().length > 0 && fieldErrors.name) errors.name = fieldErrors.name;
    if (target && fieldErrors.targetAmount) errors.targetAmount = fieldErrors.targetAmount;
    if (deadline && fieldErrors.deadline) errors.deadline = fieldErrors.deadline;
    if (starting && fieldErrors.startingAmount) errors.startingAmount = fieldErrors.startingAmount;
  }

  const clearServer = (field: keyof FormErrors) =>
    setServerErrors((prev) => {
      if (!prev[field] && !prev.form) return prev;
      const next = { ...prev };
      delete next[field];
      delete next.form;
      return next;
    });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors || busy.current) return;
    busy.current = true;
    const result = space
      ? actions.updateSpace(space.id, {
          name,
          icon,
          targetAmount,
          ...(space.type === "goal" ? { deadline: deadline || null } : {}),
        })
      : actions.createSpace({
          idempotencyId: intentId,
          name,
          type: type === "goal" ? "goal" : "custom",
          icon,
          targetAmount,
          deadline: type === "goal" && deadline ? deadline : null,
          ...(startingAmount > 0 ? { startingAmount } : {}),
        });
    if (result.ok) {
      // Stays busy until the sheet reopens: a second click while the
      // sheet animates out does nothing (the store would replay anyway).
      onSaved?.(
        result.value.spaceId,
        space ? `${name.trim()} was updated.` : `${name.trim()} was created.`,
      );
      onClose();
      return;
    }
    busy.current = false;
    const { field, message } = result.error;
    setServerErrors(
      field === "amount"
        ? { startingAmount: message }
        : field
          ? { [field]: message }
          : { form: message },
    );
    // Nothing was created; a corrected attempt is a new intent.
    setIntentId(makeId("spc"));
  };

  const isGoal = type === "goal";
  const title = editing ? `Edit ${space?.name ?? "space"}` : isGoal ? "New goal" : "New space";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form id={formId} onSubmit={submit} noValidate className="space-y-5">
        {!editing && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Type</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "goal", label: "Goal", hint: "Save toward a target" },
                  { value: "custom", label: "Space", hint: "Set money aside for anything" },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "cursor-pointer rounded-xl border p-3 transition-colors duration-150",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                    type === option.value
                      ? "border-accent/60 bg-accent/10"
                      : "border-line bg-surface-2 hover:bg-surface-3",
                  )}
                >
                  <input
                    type="radio"
                    name={`${formId}-type`}
                    value={option.value}
                    checked={type === option.value}
                    onChange={() => {
                      setType(option.value);
                      clearServer("type");
                    }}
                    className="sr-only"
                  />
                  <span className="block text-sm font-semibold text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{option.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <Input
          label="Name"
          value={name}
          maxLength={SPACE_NAME_MAX + 5}
          autoComplete="off"
          placeholder={isGoal ? "e.g. New headphones" : "e.g. Emergency fund"}
          onChange={(e) => {
            setName(e.target.value);
            clearServer("name");
          }}
          error={errors.name}
          hint={`Up to ${SPACE_NAME_MAX} characters, unique among your spaces.`}
        />

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Icon</legend>
          <div className="grid grid-cols-6 gap-2">
            {SPACE_ICONS.map((option) => {
              const Icon = SPACE_ICON_COMPONENTS[option];
              const selected = icon === option;
              return (
                <label
                  key={option}
                  className={cn(
                    "flex h-11 cursor-pointer items-center justify-center rounded-xl border transition-colors duration-150",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                    selected
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-line bg-surface-2 text-ink-muted hover:text-ink",
                  )}
                >
                  <input
                    type="radio"
                    name={`${formId}-icon`}
                    value={option}
                    checked={selected}
                    onChange={() => setIcon(option)}
                    className="sr-only"
                    aria-label={SPACE_ICON_LABELS[option]}
                  />
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </label>
              );
            })}
          </div>
        </fieldset>

        <Input
          label={isGoal ? "Target amount" : "Target amount (optional)"}
          inputMode="numeric"
          autoComplete="off"
          placeholder="₹"
          value={target ? formatINR(Number(target)) : ""}
          onChange={(e) => {
            setTarget(digitsOnly(e.target.value));
            clearServer("targetAmount");
          }}
          error={errors.targetAmount}
          hint={isGoal ? "What you're saving toward, in whole rupees." : "Leave empty for no target."}
        />

        {isGoal && (
          <Input
            label="Target date (optional)"
            type="date"
            min={today}
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              clearServer("deadline");
            }}
            error={errors.deadline}
            hint="A reminder for you. Nothing happens automatically on this date."
          />
        )}

        {!editing && (
          <Input
            label="Starting amount (optional)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="₹0"
            value={starting ? formatINR(Number(starting)) : ""}
            onChange={(e) => {
              setStarting(digitsOnly(e.target.value));
              clearServer("startingAmount");
            }}
            error={errors.startingAmount}
            hint={`Moved from your ${formatINR(available)} available.`}
          />
        )}

        {errors.form && (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        )}

        <div className="flex gap-2.5 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1">
            {editing ? "Save changes" : isGoal ? "Create goal" : "Create space"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
