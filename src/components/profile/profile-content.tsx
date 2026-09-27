"use client";

import {
  AlertTriangle,
  AtSign,
  Compass,
  Gauge,
  Info,
  ListChecks,
  QrCode,
  RotateCcw,
  Shield,
  Star,
  Users,
} from "lucide-react";
import { useState } from "react";
import { formatUsername, roleLabel } from "@/domain";
import { formatINR } from "@/lib/currency";
import {
  selectControls,
  selectLink,
  selectLinkedGuardian,
  selectMaybeTeen,
  selectSession,
  selectTeensOf,
} from "@/sandbox/selectors";
import { useSandbox, useSandboxData } from "@/sandbox/store";
import { SecuritySection } from "@/components/profile/security-section";
import { ThemeToggle } from "@/components/profile/theme-toggle";
import { RoleSwitcher } from "@/components/sandbox/role-switcher";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list-row";
import { Modal } from "@/components/ui/modal";
import { SectionHeader } from "@/components/ui/section-header";

const linkCopy = {
  not_linked: { label: "Not connected", tone: "neutral" },
  invitation_created: { label: "Invite created", tone: "warning" },
  invitation_pending: { label: "Invite pending", tone: "warning" },
  linked: { label: "Connected", tone: "success" },
  disconnected: { label: "Disconnected", tone: "neutral" },
} as const;

/**
 * Profile: Account, TeenPay ID (teens: My QR, favourites), Family,
 * Money controls, Security, Appearance, Sandbox. The sandbox section is the one place for demo controls —
 * switching role and resetting — and says so plainly.
 */
export function ProfileContent() {
  const { state, storageStatus, actions, qr, contacts } = useSandbox();
  const data = useSandboxData();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const session = selectSession(state);
  const me = session.user;
  const isTeen = session.role === "teen";
  const teen = selectMaybeTeen(state);
  const link = teen ? selectLink(state, teen.id) : null;
  const guardian = teen ? selectLinkedGuardian(state, teen.id) : null;
  const myTeens = isTeen ? [] : selectTeensOf(state, me.id);
  const controlsTeen = isTeen ? teen : (myTeens[0] ?? null);
  const account = data.accountProfile(me.id) ?? { ...me, familyMembership: null };
  const membership = account.familyMembership;
  const controls = controlsTeen ? selectControls(state, controlsTeen.id) : null;
  const status = linkCopy[link?.status ?? "not_linked"];
  // Teens only (a parent never sees a teen's mission progress).
  const missions = isTeen ? actions.missionBoard() : null;

  const familySubtitle = isTeen
    ? guardian
      ? `${guardian.displayName} is connected as your parent/guardian`
      : "Connect a parent or guardian to unlock family controls"
    : myTeens.length > 0
      ? `Connected to ${myTeens.map((t) => t.displayName).join(", ")}`
      : "Add a teen with their invite code";

  const rulesSubtitle = controls
    ? [
        controls.limits.dailyLimit !== null
          ? `${formatINR(controls.limits.dailyLimit)} a day`
          : null,
        controls.limits.perTransactionLimit !== null
          ? `up to ${formatINR(controls.limits.perTransactionLimit)} per payment`
          : null,
        controls.approval.threshold !== null
          ? `approval above ${formatINR(controls.approval.threshold)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || "No spending rules set"
    : "Available once a parent and teen are connected";

  const confirmReset = () => {
    actions.resetSandbox();
    setResetOpen(false);
    setResetDone(true);
  };

  return (
    <div className="space-y-8">
      <section aria-label="Account">
        <SectionHeader title="Account" />
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Avatar name={me.name} initials={me.avatarInitials} size="lg" ring />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-ink">{me.name}</p>
                <Badge tone="accent">{roleLabel(me.role)}</Badge>
                <Badge tone={account.deletionRequestedAt ? "warning" : "success"}>
                  {account.deletionRequestedAt
                    ? "Deletion requested"
                    : account.status === "active"
                      ? "Active"
                      : account.status === "suspended"
                        ? "Suspended"
                        : "Closed"}
                </Badge>
              </div>
              <p className="mt-1 flex items-center gap-1 truncate text-sm text-ink-muted">
                <AtSign className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="sr-only">Username </span>
                {formatUsername(me).slice(1)}
              </p>
            </div>
          </div>
          <p className="mt-4 border-t border-line pt-3.5 text-xs text-ink-faint">
            Sandbox account — fictional and not verified. No KYC, bank, or
            real account is involved.
          </p>
        </Card>
      </section>

      {isTeen && qr && (
        <section aria-label="TeenPay ID">
          <SectionHeader title="TeenPay ID" />
          <Card className="divide-y divide-line p-2">
            <ListRow
              icon={QrCode}
              title="My TeenPay QR"
              subtitle={`Let others scan to pay or request from ${qr.profile.handle}`}
              href="/qr"
            />
            <ListRow
              icon={Star}
              title="Favourites"
              subtitle={
                contacts.list.length === 0
                  ? "Save people you pay often"
                  : `${contacts.list.length} saved`
              }
              href="/contacts"
            />
          </Card>
        </section>
      )}

      {isTeen && (
        <section aria-label="Learn">
          <SectionHeader title="Learn" />
          <Card className="divide-y divide-line p-2">
            <ListRow
              icon={Compass}
              title="Money Coach"
              subtitle="A read-only look at your own money"
              href="/coach"
            />
            <ListRow
              icon={ListChecks}
              title="Money Missions"
              subtitle={
                missions?.ok
                  ? `${missions.value.completed} of ${missions.value.total} completed`
                  : "Short, optional lessons"
              }
              href="/missions"
            />
          </Card>
        </section>
      )}

      <section aria-label="Family">
        <SectionHeader title="Family" />
        <Card className="divide-y divide-line p-2">
          <ListRow
            icon={Users}
            title={state.family.name || "No family yet"}
            subtitle={familySubtitle}
            href="/family"
            right={
              isTeen ? (
                <Badge tone={status.tone}>{status.label}</Badge>
              ) : membership ? (
                <Badge tone={membership.status === "active" ? "success" : "warning"}>
                  {membership.status === "active" ? "Member" : "Pending"}
                </Badge>
              ) : undefined
            }
          />
          {isTeen && (
            <ListRow
              icon={Shield}
              title="Parent / Guardian"
              subtitle={guardian ? `${guardian.name} · ${formatUsername(guardian)}` : "Not connected"}
              href="/family"
            />
          )}
          {!isTeen && (
            <ListRow
              icon={Shield}
              title="Parent overview"
              subtitle="Balance, approvals, rules, and pocket money"
              href="/parent"
            />
          )}
        </Card>
      </section>

      <section aria-label="Money controls">
        <SectionHeader title="Money controls" />
        <Card className="divide-y divide-line p-2">
          <ListRow
            icon={Gauge}
            title={isTeen ? "Your money rules" : "Spending rules"}
            subtitle={rulesSubtitle}
            href={isTeen ? "/family" : controls ? "/parent" : "/family"}
          />
        </Card>
      </section>

      <SecuritySection />

      <section aria-label="Appearance">
        <SectionHeader title="Appearance" />
        <Card className="p-5">
          <p className="text-xs text-ink-muted">Dark is the default. Light is available.</p>
          <div className="mt-3">
            <ThemeToggle />
          </div>
        </Card>
      </section>

      <section aria-label="Sandbox">
        <SectionHeader title="Sandbox" />
        <Card className="p-5">
          <RoleSwitcher />
        </Card>
        <Card className="mt-3 divide-y divide-line p-2">
          <ListRow
            icon={RotateCcw}
            title="Reset sandbox data"
            subtitle="Restore the initial demo state"
            right={
              <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
                Reset
              </Button>
            }
          />
          {storageStatus === "unavailable" && (
            <ListRow
              icon={AlertTriangle}
              title="Storage unavailable"
              subtitle="Changes won't survive a refresh on this device"
              right={<Badge tone="warning">Warning</Badge>}
            />
          )}
          <ListRow icon={Info} title="About" subtitle="TeenPay 0.4 · Phase 4 sandbox" />
        </Card>
        <p role="status" className="mt-2 px-1 text-xs text-ink-muted">
          {resetDone ? "Sandbox reset to the initial demo state." : ""}
        </p>
      </section>

      <p className="px-1 text-xs leading-relaxed text-ink-faint">
        You&apos;re viewing sandbox data stored only on this device. TeenPay
        is a product preview — no real money, bank accounts, or payment
        providers are connected.
      </p>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset sandbox data?">
        <p className="text-sm leading-relaxed text-ink-muted">
          This restores the initial demo state: sandbox accounts you created,
          the ledger, family connection, rules, approvals, notifications,
          balances and Money Missions progress all return to where they
          started. You&apos;ll be signed out.
          Your theme preference is kept.
        </p>
        <div className="mt-5 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={() => setResetOpen(false)}>
            Keep my data
          </Button>
          <Button variant="danger" className="flex-1" onClick={confirmReset}>
            Reset
          </Button>
        </div>
      </Modal>
    </div>
  );
}
