"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { TeenCenterView } from "@/sandbox/parent-center";
import { useSandbox } from "@/sandbox/store";
import { RulesSummary } from "@/components/family/rules-summary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { SpendingRulesForm } from "./spending-rules-form";

interface ParentControlsProps {
  center: TeenCenterView;
  /** Reports a saved setting so the page can announce it. */
  onAnnounce: (message: string) => void;
}

/**
 * The Controls section of the Parent Control Center: the guardian
 * rules already in force, the account protection state, and the
 * notification choices. Nothing here evaluates rules itself — every
 * row reads the existing domain, and every edit goes through the
 * existing guardian transitions.
 */
export function ParentControls({ center, onAnnounce }: ParentControlsProps) {
  const { actions } = useSandbox();
  const [editing, setEditing] = useState(false);
  const controls = center.controls;
  const teenName = center.teen.displayName;

  const toggleNotification = (key: "payments" | "savings", value: boolean) => {
    if (!controls) return;
    const result = actions.updateGuardianNotifications({
      teenId: center.teen.accountId,
      payments: key === "payments" ? value : controls.notifications.payments,
      savings: key === "savings" ? value : controls.notifications.savings,
    });
    onAnnounce(result.ok ? "Notification settings saved." : result.error.message);
  };

  return (
    <div className="space-y-3">
      {/* Guardian rules — the same plain-words summary the teen sees,
          edited through the existing spending-rules transition. */}
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          Payment rules
        </p>
        {center.mayManageRules && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Edit rules
          </Button>
        )}
      </div>
      {controls ? (
        <RulesSummary teenId={center.teen.accountId} perspective="guardian" />
      ) : (
        <Card className="px-5 py-4">
          <p className="text-sm text-ink-muted">
            Rules apply once your family connection is fully set up.
          </p>
        </Card>
      )}

      {/* Notification choices. */}
      {controls && (
        <Card className="divide-y divide-line">
          <div className="px-5 pb-1 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              Notify me about
            </p>
          </div>
          <div className="px-5 py-4">
            <Switch
              label="Payments"
              description={`Every payment ${teenName} sends.`}
              checked={controls.notifications.payments}
              onChange={(value) => toggleNotification("payments", value)}
            />
          </div>
          <div className="px-5 py-4">
            <Switch
              label="Saving"
              description="Money moved into a Money Space (the amount only)."
              checked={controls.notifications.savings}
              onChange={(value) => toggleNotification("savings", value)}
            />
          </div>
          <p className="px-5 py-3.5 text-xs text-ink-muted">
            Approval requests always reach you. {teenName} can see these settings in Family.
          </p>
        </Card>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Spending rules">
        <SpendingRulesForm
          teenId={center.teen.accountId}
          teenName={teenName}
          onSaved={(message) => {
            setEditing(false);
            onAnnounce(message);
          }}
          onCancel={() => setEditing(false)}
        />
      </Modal>
    </div>
  );
}
