import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { walletBalance } from "@/sandbox/engine";
import {
  acceptInviteTransition,
  claimInviteTransition,
  createInviteTransition,
} from "@/sandbox/family-transitions";
import { approveTransferTransition } from "@/sandbox/peer-transitions";
import { scopeFor, mergeScope } from "@/sandbox/scope";
import { decideApprovalTransition } from "@/sandbox/transitions";
import { SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, linkedDatabase, preloadDatabase, SANDBOX_KEY, TEEN_WALLET } from "./helpers/fixtures";
import { resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

const MEERA_WALLET = "wal_usr_meera";
const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const meera = () => walletBalance(db().ledger, MEERA_WALLET);
const transfers = () => db().operations.filter((op) => op.type === "transfer");
const pendingApprovals = () =>
  db().teenRecords.flatMap((r) => r.approvals).filter((a) => a.status === "pending");

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
}

async function signedIn(accountId: string, role: "teen" | "parent", path: string) {
  const service = createSandboxAuthService();
  await service.signIn({ method: "sandbox", accountId, role }, Date.now());
  resetRouter(path);
  const view = render(<TestApp service={service} />);
  await settle();
  return view;
}

async function pickMeera(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("searchbox", { name: /who are you sending to/i }), "mee");
  const list = await screen.findByRole("list", { name: "TeenPay users" });
  await user.click(within(list).getByRole("button", { name: /Meera Kapoor/ }));
}

/** Seed + threshold rule + one ₹600 send waiting on Priya. */
async function arrangePendingApproval(user: ReturnType<typeof userEvent.setup>) {
  const rules = { threshold: 500 };
  preloadDatabase(linkedDatabase(rules));
  const view = await signedIn(SEED_TEEN_ID, "teen", "/send");
  await pickMeera(user);
  await user.type(await screen.findByLabelText("Amount"), "600");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(await screen.findByRole("button", { name: "Ask Priya to approve" }));
  await waitFor(() => expect(pendingApprovals()).toHaveLength(1));
  view.unmount();
  cleanup();
}

/**
 * The Approval Center decides through `decideApproval` /
 * `approveTransferTransition` only — nothing here writes the ledger
 * directly, and every guardrail the engine has stays intact.
 */
describe("parent approval center", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(SANDBOX_KEY);
  });

  it("declining from the center moves nothing and tells the teen", async () => {
    const user = userEvent.setup();
    await arrangePendingApproval(user);
    const before = { aarav: aarav(), meera: meera(), ledger: db().ledger.length };

    const view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(await screen.findByRole("button", { name: "Decline ₹600 to @meera" }));
    await waitFor(() => expect(pendingApprovals()).toHaveLength(0));

    // Nothing moved — balances, ledger length and transfers unchanged.
    expect(aarav()).toBe(before.aarav);
    expect(meera()).toBe(before.meera);
    expect(db().ledger.length).toBe(before.ledger);
    expect(transfers()).toHaveLength(0);
    // The center settles; the decision is listed as declined.
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
    const approvalsSection = screen.getByRole("region", { name: "Approvals" });
    expect(within(approvalsSection).getAllByText(/declined/i).length).toBeGreaterThan(0);
    // And Aarav heard about it once.
    expect(
      db().notifications.filter((n) => n.recipientId === SEED_TEEN_ID).length,
    ).toBeGreaterThan(0);
    view.unmount();
  }, 120_000);

  it("approving twice — even with a replayed transition — never posts twice", async () => {
    const user = userEvent.setup();
    await arrangePendingApproval(user);

    const view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(await screen.findByRole("button", { name: "Approve ₹600 to @meera" }));
    await waitFor(() => expect(transfers()).toHaveLength(1));
    const after = { aarav: aarav(), meera: meera() };

    // The card is gone; replay at the engine level is a documented no-op.
    const approval = db().teenRecords.find((r) => r.teenId === SEED_TEEN_ID)!.approvals[0]!;
    const replay = approveTransferTransition(db(), {
      actorId: SEED_PARENT_ID,
      at: AT,
      approvalId: approval.id,
    });
    expect(replay.result.ok).toBe(true); // idempotent…
    expect(replay.db).toEqual(db()); // …but nothing changes.
    expect(transfers()).toHaveLength(1);
    expect(aarav()).toBe(after.aarav);
    expect(meera()).toBe(after.meera);
    // Approving again from a fresh session changes nothing either.
    view.unmount();
    cleanup();
    const second = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    expect(screen.queryByRole("button", { name: "Approve ₹600 to @meera" })).not.toBeInTheDocument();
    expect(transfers()).toHaveLength(1);
    second.unmount();
  }, 120_000);

  it("a parent with no link to the teen cannot decide — the engine refuses", async () => {
    const user = userEvent.setup();
    await arrangePendingApproval(user);

    // Sunita: a real parent, linked to her own teen — not to Aarav.
    let stored = db();
    const rohan = createAccount(stored, { role: "teen", displayName: "Rohan Verma", username: "rohan" }, AT);
    if ("code" in rohan) throw new Error("create failed");
    stored = rohan.db;
    const sunita = createAccount(stored, { role: "parent", displayName: "Sunita Verma", username: "sunita" }, AT);
    if ("code" in sunita) throw new Error("create failed");
    stored = sunita.db;
    const run = (
      actorId: string,
      fn: (s: SandboxState) => { state: SandboxState; result: { ok: boolean } },
      familyId?: string,
    ) => {
      const scope = scopeFor(stored, actorId, familyId ? { familyId } : {});
      if (!scope) throw new Error("no scope");
      const out = fn(scope.state);
      if (!out.result.ok) throw new Error("transition failed");
      stored = mergeScope(stored, scope.info, scope.state, out.state);
    };
    const rohanFamily = stored.families.find((f) =>
      f.members.some((m) => m.accountId === rohan.account.id && m.role === "teen"),
    )!.id;
    run(rohan.account.id, (s) => createInviteTransition(s, { actorId: rohan.account.id, at: AT, code: "TEEN-7777" }));
    run(sunita.account.id, (s) => claimInviteTransition(s, { actorId: sunita.account.id, at: AT, code: "TEEN-7777" }), rohanFamily);
    run(sunita.account.id, (s) => acceptInviteTransition(s, { actorId: sunita.account.id, at: AT, teenId: rohan.account.id }), rohanFamily);
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(stored));

    const approval = pendingApprovals()[0]!;
    const before = JSON.stringify([db().ledger, db().operations]);

    // Through the transfer engine: refused — Sunita's scope has no such
    // approval, and nothing is written.
    const viaPeer = approveTransferTransition(db(), {
      actorId: sunita.account.id,
      at: AT,
      approvalId: approval.id,
    });
    expect(viaPeer.result.ok).toBe(false);

    // Through the family transition: refused by authorization.
    const priyaScope = scopeFor(db(), SEED_PARENT_ID)!;
    const viaFamily = decideApprovalTransition(priyaScope.state, {
      actorId: sunita.account.id,
      decision: "approve",
      approvalId: approval.id,
      at: AT,
    });
    expect(viaFamily.result.ok).toBe(false);

    // And the teen can't approve their own request either.
    const viaTeen = decideApprovalTransition(priyaScope.state, {
      actorId: SEED_TEEN_ID,
      decision: "approve",
      approvalId: approval.id,
      at: AT,
    });
    expect(viaTeen.result.ok).toBe(false);

    expect(JSON.stringify([db().ledger, db().operations])).toBe(before);
    expect(pendingApprovals()).toHaveLength(1);
    // The rightful guardian can still decide afterwards.
    const ok = approveTransferTransition(db(), {
      actorId: SEED_PARENT_ID,
      at: AT,
      approvalId: approval.id,
    });
    expect(ok.result.ok).toBe(true);
    // Engine-level result: the transfer posted in the returned database.
    expect(ok.db.operations.filter((op) => op.type === "transfer")).toHaveLength(1);
    void user;
  }, 120_000);

  it("an approved payment posts the same two-leg transfer the teen's flow would", async () => {
    const user = userEvent.setup();
    await arrangePendingApproval(user);

    const view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(await screen.findByRole("button", { name: "Approve ₹600 to @meera" }));
    await waitFor(() => expect(transfers()).toHaveLength(1));

    const teenEntries = db().ledger.filter((e) => e.walletId === TEEN_WALLET);
    const meeraEntries = db().ledger.filter((e) => e.walletId === MEERA_WALLET);
    const out = teenEntries.filter((e) => e.direction === "debit").at(-1)!;
    const inbound = meeraEntries.filter((e) => e.direction === "credit").at(-1)!;
    expect(out.amount).toBe(600);
    expect(inbound.amount).toBe(600);
    expect(aarav()).toBe(1850 - 600);
    expect(meera()).toBe(1200 + 600);
    view.unmount();
  }, 120_000);
});
