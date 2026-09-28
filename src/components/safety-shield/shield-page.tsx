"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ShieldSettings } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

const REQUIRED_PROTECTIONS = [
  {
    title: "Guardian approvals",
    description: "Payments above your guardian's threshold always wait for them.",
  },
  {
    title: "Daily and per-payment limits",
    description: "Limits your guardian sets are always enforced.",
  },
  {
    title: "Balance and wallet checks",
    description: "You can never send money you don't have, or from a frozen wallet.",
  },
  {
    title: "One payment per action",
    description: "A double click or retry can never move money twice.",
  },
] as const;

/**
 * Safety Shield: what TeenPay pauses and reviews for, and the teen's
 * own optional reminders. Calm by design — no scores, no labels, no
 * surveillance. Required protections are listed as facts (they aren't
 * settings and can't be switched off); the toggles only soften the
 * extra confirmation steps into inline reminders.
 */
export function ShieldPage() {
  const { actions, shield } = useSandbox();
  const [message, setMessage] = useState<string | null>(null);

  const update = (key: keyof ShieldSettings, checked: boolean, label: string) => {
    const result = actions.updateShieldSettings({ [key]: checked });
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setMessage(`${label} ${result.value.settings[key] ? "on" : "off"}.`);
  };

  return (
    <>
      <PageHeader
        title="Safety Shield"
        description="You're in control. TeenPay can help you pause and review certain actions before money moves."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />

      <div className="space-y-6">
        <section aria-label="Required protections">
          <Card className="p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
              Always on
            </p>
            <ul className="mt-3 space-y-3.5">
              {REQUIRED_PROTECTIONS.map((protection) => (
                <li key={protection.title} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-ink">{protection.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                      {protection.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-line pt-3.5 text-[11px] leading-relaxed text-ink-faint">
              These come from the payment engine itself. They can&apos;t be switched off here — by
              anyone.
            </p>
          </Card>
        </section>

        <section aria-label="Optional reminders">
          <Card className="divide-y divide-line">
            <div className="p-4">
              <Switch
                label="First-time recipient checks"
                description="An extra moment to confirm the name, ID and amount before your first payment to someone."
                checked={shield.firstTimeRecipient}
                onChange={(checked) => update("firstTimeRecipient", checked, "First-time recipient checks")}
              />
            </div>
            <div className="p-4">
              <Switch
                label="Large payment review"
                description="An extra moment when a payment uses half or more of the money you can send."
                checked={shield.largePayments}
                onChange={(checked) => update("largePayments", checked, "Large payment review")}
              />
            </div>
            <div className="p-4">
              <Switch
                label="Repeated payment review"
                description="An extra moment when you send several payments to the same person in a day."
                checked={shield.repeatedPayments}
                onChange={(checked) => update("repeatedPayments", checked, "Repeated payment review")}
              />
            </div>
          </Card>
          <p
            role="status"
            aria-live="polite"
            className={message ? "mt-3 px-1 text-sm text-ink-muted" : "sr-only"}
          >
            {message ?? ""}
          </p>
        </section>

        <section aria-label="Privacy">
          <Card className="p-5">
            <p className="text-sm font-medium text-ink">Private by design</p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              Safety checks run on this device, only when you take an action, using only what
              TeenPay already knows. There&apos;s no scoring, no background watching, and nothing
              here is reported to your parent — family controls stay exactly where they were.
            </p>
          </Card>
        </section>
      </div>
    </>
  );
}
