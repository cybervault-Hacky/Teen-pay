"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface RuleFieldProps {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  /** Raw digits. */
  digits: string;
  onDigits: (digits: string) => void;
  inputLabel: string;
  hint?: string;
  error?: string;
}

/** One optional rupee rule: an on/off switch plus its amount. */
export function RuleField({
  label,
  description,
  enabled,
  onToggle,
  digits,
  onDigits,
  inputLabel,
  hint,
  error,
}: RuleFieldProps) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2/40 p-4">
      <Switch
        label={label}
        description={description}
        checked={enabled}
        onChange={onToggle}
      />
      {enabled && (
        <Input
          className="mt-3.5"
          label={inputLabel}
          inputMode="numeric"
          autoComplete="off"
          placeholder="₹"
          value={digits}
          onChange={(event) =>
            onDigits(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
          hint={hint}
          error={error}
        />
      )}
    </div>
  );
}

export function toDigits(value: number | null): string {
  return value === null ? "" : String(value);
}
