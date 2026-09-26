"use client";

import { BadgeCheck, Moon, Plus, ShieldCheck, Smartphone, Sun } from "lucide-react";
import { useState } from "react";
import { Container } from "@/components/shell";
import { useTheme } from "@/app/providers";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ComingSoonSheet,
  Divider,
  Notice,
  Reveal,
  SectionHeader,
  Switch,
} from "@/components/ui";
import { isSampleData, mockHousehold, mockTeen } from "@/data/mock";

/** Profile — identity, family and settings. */
export default function ProfilePage() {
  const { theme, toggleTheme } = useTheme();
  const [sheet, setSheet] = useState<{ feature: string; body: string } | null>(null);
  const parent = mockHousehold.parents[0];

  return (
    <Container width="narrow">
      <div className="flex flex-col gap-7 pt-5 sm:pt-8">
        <Reveal>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">
            Profile
          </h1>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="flex items-center gap-4 p-5">
            <Avatar name={mockTeen.displayName} size="xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-semibold tracking-tight text-ink">
                {mockTeen.displayName}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                Teen account · {mockHousehold.family.name}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="accent">Teen</Badge>
                {isSampleData() && <Badge tone="neutral">Sample data</Badge>}
              </div>
            </div>
          </Card>
        </Reveal>

        <Reveal>
          <section aria-labelledby="family-section">
            <SectionHeader
              title="Family"
              caption="Money works better together"
            />
            <h2 id="family-section" className="sr-only">
              Family
            </h2>
            <Card className="mt-3 p-4">
              {parent && (
                <div className="flex items-center gap-3.5">
                  <Avatar name={parent.displayName} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-ink">
                      {parent.displayName}
                    </p>
                    <p className="mt-0.5 text-[13px] text-faint capitalize">
                      {parent.relationship}
                    </p>
                  </div>
                  <Badge tone="success">
                    <BadgeCheck className="size-3.5" aria-hidden="true" />
                    Guardian
                  </Badge>
                </div>
              )}
              <div className="mt-4 border-t border-line pt-4">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-10 items-center justify-center rounded-xl bg-surface-3 text-muted"
                    aria-hidden="true"
                  >
                    <ShieldCheck className="size-5" />
                  </span>
                  <p className="flex-1 text-sm text-muted">
                    Approvals and spending plans live with your family.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  fullWidth
                  icon={<Plus className="size-4" aria-hidden="true" />}
                  onClick={() =>
                    setSheet({
                      feature: "Invite a parent",
                      body: "Add a parent or guardian to your family.",
                    })
                  }
                  className="mt-4"
                >
                  Invite a parent
                </Button>
              </div>
            </Card>
          </section>
        </Reveal>

        <Reveal>
          <section aria-labelledby="settings-section">
            <SectionHeader title="Settings" />
            <h2 id="settings-section" className="sr-only">
              Settings
            </h2>
            <Card className="mt-3 px-4 py-1.5">
              <div className="flex items-center gap-3.5 py-3.5">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted"
                  aria-hidden="true"
                >
                  {theme === "dark" ? <Moon className="size-5" /> : <Sun className="size-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-ink">
                    Appearance
                  </span>
                  <span className="mt-0.5 block text-[13px] text-faint">
                    {theme === "dark" ? "Dark" : "Light"} theme
                  </span>
                </span>
                <Switch checked={theme === "light"} onChange={toggleTheme} label="Toggle light theme" />
              </div>
              <Divider />
              <div className="flex items-center gap-3.5 py-3.5">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted"
                  aria-hidden="true"
                >
                  <Smartphone className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-ink">
                    Motion
                  </span>
                  <span className="mt-0.5 block text-[13px] text-faint">
                    Follows your system&apos;s reduce-motion setting
                  </span>
                </span>
                <Badge tone="neutral">Auto</Badge>
              </div>
              <Divider />
              <div className="flex items-center gap-3.5 py-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted"
                  aria-hidden="true"
                >
                  <BadgeCheck className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-ink">
                    TeenPay Preview
                  </span>
                  <span className="mt-0.5 block text-[13px] text-faint">
                    v0.1.0 · Phase 1 foundation
                  </span>
                </span>
              </div>
            </Card>
          </section>
        </Reveal>

        <Reveal>
          <Notice tone="neutral" title="Why sample data?">
            TeenPay is in preview. Balances, people and activity are realistic
            examples so you can explore the design — nothing here is real money.
          </Notice>
        </Reveal>
      </div>

      <ComingSoonSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        feature={sheet?.feature ?? ""}
        body={sheet?.body}
      />
    </Container>
  );
}
