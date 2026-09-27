"use client";

import { useState } from "react";
import { formatINR } from "@/lib/currency";
import { selectControls } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { MAX_DAILY_LIMIT, MAX_SANDBOX_AMOUNT } from "@/sandbox/types";
import { Button } from "@/components/ui/button";
import { RuleField, toDigits } from "./rule-field";

interface SpendingRulesFormProps {
  teenId: string;
  teenName: string;
  onSaved: (message: string) => void;
  onCancel: () => void;
}

type Field = "daily" | "perTx" | "threshold";

/**
 * Edits the teen's spending rules. Validation lives in the engine
 * (`validateSpendingRules`); this form only collects numbers and
 * shows whatever the engine says.
 */
export function SpendingRulesForm({
  teenId,
  teenName,
  onSaved,
  onCancel,
}: SpendingRulesFormProps) {
  const { state, actions } = useSandbox();
  const controls = selectControls(state, teenId);

  const [on, setOn] = useState<Record<Field, boolean>>({
    daily: controls?.limits.dailyLimit != null,
    perTx: controls?.limits.perTransactionLimit != null,
    threshold: controls?.approval.threshold != null,
  });
  const [digits, setDigits] = useState<Record<Field, string>>({
    daily: toDigits(controls?.limits.dailyLimit ?? 500),
    perTx: toDigits(controls?.limits.perTransactionLimit ?? 1000),
    threshold: toDigits(controls?.approval.threshold ?? 500),
  });
  const [error, setError] = useState<string | null>(null);

  const valueOf = (field: Field): number | null =>
    on[field] ? (digits[field] === "" ? 0 : Number(digits[field])) : null;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const result = actions.updateSpendingRules({
      teenId,
      limits: {
        dailyLimit: valueOf("daily"),
        perTransactionLimit: valueOf("perTx"),
      },
      approval: { threshold: valueOf("threshold") },
    });
    if (result.ok) {
      onSaved(`Spending rules saved. ${teenName} can see them in Family.`);
    } else {
      setError(result.error.message);
    }
  };

  const bind = (field: Field) => ({
    enabled: on[field],
    onToggle: (next: boolean) => {
      setOn((prev) => ({ ...prev, [field]: next }));
      setError(null);
    },
    digits: digits[field],
    onDigits: (next: string) => {
      setDigits((prev) => ({ ...prev, [field]: next }));
      setError(null);
    },
  });

  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      <p className="text-sm text-ink-muted">
        {teenName} sees every rule you set here. These are family rules —
        separate from the {formatINR(MAX_SANDBOX_AMOUNT)} sandbox cap per move.
      </p>
      <RuleField
        {...bind("daily")}
        label="Daily limit"
        description={`Most ${teenName} can send in a day on their own.`}
        inputLabel="Daily limit amount"
        hint={`₹1 – ${formatINR(MAX_DAILY_LIMIT)}. Resets at midnight.`}
      />
      <RuleField
        {...bind("perTx")}
        label="Per-payment limit"
        description="Largest single payment, even with approval."
        inputLabel="Per-payment limit amount"
        hint={`₹1 – ${formatINR(MAX_SANDBOX_AMOUNT)}`}
      />
      <RuleField
        {...bind("threshold")}
        label="Ask me first"
        description="Payments above this amount wait for your approval."
        inputLabel="Approval amount"
        hint="You decide on these — once approved, the daily limit won't block them."
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2.5 pt-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1">
          Save rules
        </Button>
      </div>
    </form>
  );
}
