"use client";

import Link from "next/link";
import { BadgeCheck, Moon, RotateCcw, ShieldCheck, Smartphone, Sun, UsersRound } from "lucide-react";
import { useState } from "react";
import { Container } from "@/components/shell";
import { useTheme } from "@/app/providers";
import {
  Avatar,
  Badge,
  Button,
  buttonClassName,
  Card,
  Divider,
  Notice,
  Reveal,
  SandboxBadge,
  SectionHeader,
  Sheet,
  Switch,
} from "@/components/ui";
import { useSandbox } from "@/sandbox";

/** Profile — identity, family, settings and sandbox controls. */
export default function ProfilePage() {
  const { theme, toggleTheme } = useTheme();
  const { teen, parent, household, resetSandbox } = useSandbox();
  const [resetOpen, setResetOpen] = useState(false);

  const handleReset = () => {
    resetSandbox();
    setResetOpen(false);
  };

  return (
    <Container width="narrow">
      <div className="flex flex-col gap-7 pt-5 sm:pt-8">
        <Reveal>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">
              Profile
            </h1>
            <SandboxBadge />
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="flex items-center gap-4 p-5">
            <Avatar name={teen.displayName} size="xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-semibold tracking-tight text-ink">
                {teen.displayName}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                Teen account · {household.family.name}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="accent">Teen</Badge>
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
              <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
                <Link
                  href="/parent"
                  className={buttonClassName({ variant: "secondary", fullWidth: true })}
                >
                  <UsersRound className="size-4" aria-hidden="true" />
                  Open parent view
                </Link>
                <div className="flex items-center gap-3 pt-1">
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
                    TeenPay Sandbox
                  </span>
                  <span className="mt-0.5 block text-[13px] text-faint">
                    v0.2.0 · Phase 2 local ledger
                  </span>
                </span>
              </div>
            </Card>
          </section>
        </Reveal>

        <Reveal>
          <section aria-labelledby="sandbox-section">
            <SectionHeader title="Sandbox" caption="Local demo data lives on this device" />
            <h2 id="sandbox-section" className="sr-only">
              Sandbox
            </h2>
            <Card className="mt-3 p-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 items-center justify-center rounded-xl bg-surface-3 text-muted"
                  aria-hidden="true"
                >
                  <RotateCcw className="size-5" />
                </span>
                <p className="flex-1 text-sm text-muted">
                  Start over with a fresh ledger, requests and notifications.
                </p>
              </div>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setResetOpen(true)}
                className="mt-4"
              >
                Reset sandbox data
              </Button>
            </Card>
          </section>
        </Reveal>

        <Reveal>
          <Notice tone="neutral" title="Simulated money">
            Balances, payments and requests run against a local sandbox ledger
            on this device — nothing here is real money.
          </Notice>
        </Reveal>
      </div>

      <Sheet
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset sandbox data?"
        description="This clears your local ledger, requests and notifications, then starts fresh."
        footer={
          <div className="flex gap-2.5">
            <Button variant="secondary" fullWidth onClick={() => setResetOpen(false)}>
              Keep my data
            </Button>
            <Button variant="danger" fullWidth onClick={handleReset}>
              Reset everything
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          Only sandbox data on this device is affected. Nothing outside this
          demo can be touched — there is no real account behind it.
        </p>
      </Sheet>
    </Container>
  );
}
