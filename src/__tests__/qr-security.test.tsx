import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useOptionalAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { addContactTransition } from "@/sandbox/contacts";
import { spaceBalance } from "@/sandbox/engine";
import { sendMoneyTransition } from "@/sandbox/peer-transitions";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { buildSeedDatabase, SEED_GOAL_SPACE_ID, SEED_PARENT_ID, SEED_PEER_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import { SandboxProvider, useOptionalSandbox, useSandbox, type SandboxContextValue } from "@/sandbox/store";
import type { SandboxDatabase } from "@/sandbox/types";
import { isProtectedRoute } from "@/lib/navigation";
import { AT, balanceOf, preloadDatabase, storedDatabase } from "./helpers/fixtures";
import { nav, resetRouter } from "./helpers/router";
import { TestApp } from "./helpers/app";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return { usePathname: router.usePathname, useRouter: router.useRouter, useSearchParams: router.useSearchParams };
});

window.matchMedia = (query: string) =>
  ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

/**
 * Phase 9 — the store boundary for QR and favourites: actions are
 * bound to the signed-in viewer, read-only QR actions never move
 * money, and a signed-out (stale) screen can do nothing.
 */

let sandbox: SandboxContextValue | null = null;
beforeEach(() => {
  sandbox = null;
  localStorage.clear();
  resetRouter("/");
});

function Capture() {
  sandbox = useSandbox();
  return null;
}

async function mountAs(viewerId: string, db: SandboxDatabase = buildSeedDatabase()) {
  preloadDatabase(db);
  render(
    <SandboxProvider viewerId={viewerId}>
      <Capture />
    </SandboxProvider>,
  );
  await waitFor(() => expect(sandbox).not.toBeNull());
  return sandbox!;
}

function ok(out: { db: SandboxDatabase; result: { ok: boolean } }): SandboxDatabase {
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return out.db;
}

describe("QR store actions", () => {
  it("createQrPayload is the viewer's own public identity; the context exposes it read-only", async () => {
    const live = await mountAs(SEED_TEEN_ID);
    expect(live.actions.createQrPayload()).toEqual({
      ok: true,
      value: { payload: "teenpay://user/@aarav?v=1", profile: { handle: "@aarav", name: "Aarav Sharma", initials: "AS" } },
    });
    expect(live.qr).toEqual({ payload: "teenpay://user/@aarav?v=1", profile: { handle: "@aarav", name: "Aarav Sharma", initials: "AS" } });
  });

  it("each teen gets their own code; a parent gets none", async () => {
    const meera = await mountAs(SEED_PEER_ID);
    expect(meera.qr?.payload).toBe("teenpay://user/@meera?v=1");
  });

  it("a parent has no QR identity", async () => {
    const parent = await mountAs(SEED_PARENT_ID);
    expect(parent.qr).toBeNull();
    expect(parent.actions.createQrPayload()).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });

  it("start pay / request only resolve and hand back a link — nothing is written", async () => {
    const live = await mountAs(SEED_TEEN_ID);
    const before = localStorage.getItem("teenpay-sandbox-v1");
    expect(live.actions.startQrPayment("teenpay://user/@meera?v=1")).toEqual({
      ok: true,
      value: { recipient: { handle: "@meera", name: "Meera Kapoor", initials: "MK" }, href: "/send?to=meera&via=qr" },
    });
    expect(live.actions.startQrRequest(" teenpay://user/@meera?v=1 ")).toMatchObject({
      ok: true,
      value: { href: "/request?to=meera&via=qr" },
    });
    expect(live.actions.resolveQrIdentity("teenpay://user/@meera?v=1")).toMatchObject({ ok: true, value: { handle: "@meera" } });
    expect(localStorage.getItem("teenpay-sandbox-v1")).toBe(before);
  });

  it("spoofed, tampered and id-carrying codes are refused before anything happens", async () => {
    const live = await mountAs(SEED_TEEN_ID);
    const spoofs = [
      "upi://pay?pa=meera@bank&am=500",
      "https://teenpay.example/user/@meera",
      "teenpay://user/@meera",
      "teenpay://user/@meera?v=1&v=1",
      "teenpay://user/@meera?v=1&to=usr_kabir",
      "teenpay://user/@usr_meera?v=1",
      "teenpay://user/@wal_usr_meera?v=1",
      "teenpay://user/@meera?v=1#pay=500",
      "teenpay://user/@me%65ra?v=1",
      `teenpay://user/@${"a".repeat(200)}?v=1`,
    ];
    for (const payload of spoofs) {
      for (const result of [live.actions.resolveQrIdentity(payload), live.actions.startQrPayment(payload), live.actions.startQrRequest(payload)]) {
        expect(result).toMatchObject({ ok: false, error: { code: "invalid_qr" } });
      }
    }
    expect(live.actions.startQrPayment("teenpay://user/@aarav?v=1")).toMatchObject({ ok: false, error: { code: "self_transfer" } });
    expect(live.actions.startQrPayment("teenpay://user/@priya?v=1")).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
  });

  it("a code for someone whose account closed resolves to nobody", async () => {
    const db = buildSeedDatabase();
    const closed = { ...db, accounts: db.accounts.map((a) => (a.id === SEED_PEER_ID ? { ...a, status: "closed" as const } : a)) };
    const live = await mountAs(SEED_TEEN_ID, closed);
    expect(live.actions.startQrPayment("teenpay://user/@meera?v=1")).toMatchObject({
      ok: false,
      error: { code: "unknown_recipient", message: "No TeenPay user found." },
    });
  });
});

describe("QR payments use available money only", () => {
  /** Aarav: ₹2,000 total, ₹1,200 in Spaces (Save ₹800 + Bike ₹400) → ₹800 available. */
  function twoThousandTotal(): SandboxDatabase {
    let db = buildSeedDatabase();
    const scope = scopeFor(db, SEED_TEEN_ID)!;
    const back = moveSpaceMoneyTransition(scope.state, {
      actorId: SEED_TEEN_ID, at: AT, spaceId: SEED_GOAL_SPACE_ID, amount: 1100, direction: "withdraw", operationId: "spc_qr_back_01",
    });
    if (!back.result.ok) throw new Error(JSON.stringify(back.result));
    db = mergeScope(db, scope.info, scope.state, back.state);
    db = ok(sendMoneyTransition(db, { actorId: SEED_TEEN_ID, at: AT, recipient: "@meera", amount: 2150, idempotencyKey: "snd_qr_setup_01" }));
    return db;
  }

  it("total ₹2,000 with ₹1,200 in Spaces: a QR ₹900 payment fails and Spaces are untouched", async () => {
    const db = twoThousandTotal();
    expect(balanceOf(db, SEED_TEEN_ID)).toBe(800);
    expect(spaceBalance(db.ledger, SEED_SAVE_SPACE_ID) + spaceBalance(db.ledger, SEED_GOAL_SPACE_ID)).toBe(1200);
    const live = await mountAs(SEED_TEEN_ID, db);
    const started = live.actions.startQrPayment("teenpay://user/@meera?v=1");
    expect(started).toMatchObject({ ok: true, value: { href: "/send?to=meera&via=qr" } });
    let sent: ReturnType<typeof live.actions.sendMoney> | undefined;
    act(() => {
      sent = live.actions.sendMoney({ recipient: "@meera", amount: 900, idempotencyKey: "snd_qr_over_001" });
    });
    expect(sent).toMatchObject({
      ok: false,
      error: { code: "insufficient_balance", message: "Not enough available money. You have ₹800 available." },
    });
    const after = storedDatabase();
    expect(after.operations).toEqual(db.operations);
    expect(spaceBalance(after.ledger, SEED_SAVE_SPACE_ID)).toBe(800);
    expect(spaceBalance(after.ledger, SEED_GOAL_SPACE_ID)).toBe(400);
  });
});

describe("favourites store actions", () => {
  it("add and remove are bound to the viewer and persisted; views show name + handle only", async () => {
    const live = await mountAs(SEED_TEEN_ID);
    let added: ReturnType<typeof live.actions.addContact> | undefined;
    act(() => {
      added = live.actions.addContact("@meera", "ctc_store_0001");
    });
    expect(added).toMatchObject({ ok: true, value: { replayed: false, contact: { handle: "@meera" } } });
    await waitFor(() => expect(sandbox!.contacts.list).toHaveLength(1));
    expect(sandbox!.contacts.list[0]).toEqual({ handle: "@meera", name: "Meera Kapoor", initials: "MK", available: true, savedAt: expect.any(String) });
    expect(sandbox!.contacts.isFavourite("meera")).toBe(true);
    expect(storedDatabase().contacts).toMatchObject([{ ownerAccountId: SEED_TEEN_ID, teenPayId: "meera" }]);
    // Double submit with the same key: one record.
    act(() => {
      expect(sandbox!.actions.addContact("@meera", "ctc_store_0001")).toMatchObject({ ok: true, value: { replayed: true } });
    });
    expect(storedDatabase().contacts).toHaveLength(1);

    act(() => {
      expect(sandbox!.actions.removeContact("@meera")).toEqual({ ok: true, value: { removed: "@meera" } });
    });
    await waitFor(() => expect(sandbox!.contacts.list).toEqual([]));
    expect(storedDatabase().contacts).toEqual([]);
  });

  it("no cross-account reach: Meera's favourites are invisible to Aarav and he can't remove them", async () => {
    const db = ok(addContactTransition(buildSeedDatabase(), { actorId: SEED_PEER_ID, at: AT, teenPayId: "@aarav", contactId: "ctc_meera_0001" }));
    const live = await mountAs(SEED_TEEN_ID, db);
    expect(live.contacts.list).toEqual([]);
    expect(live.state.contacts).toEqual([]);
    expect(live.actions.removeContact("@aarav")).toMatchObject({ ok: false, error: { code: "unknown_contact" } });
    expect(live.actions.removeContact("usr_meera")).toMatchObject({ ok: false, error: { code: "unknown_contact" } });
    expect(storedDatabase().contacts).toHaveLength(1);
  });

  it("id injection into add is refused", async () => {
    const live = await mountAs(SEED_TEEN_ID);
    for (const id of [SEED_PEER_ID, "wal_usr_meera", "fam_kapoor", "@usr_meera", "sandbox:usr_meera"]) {
      expect(live.actions.addContact(id).ok).toBe(false);
    }
    expect(storedDatabase().contacts).toEqual([]);
  });
});

describe("a stale screen after sign-out can do nothing", () => {
  it("every QR and favourite action returns not_signed_in and nothing changes", async () => {
    preloadDatabase(ok(addContactTransition(buildSeedDatabase(), { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", contactId: "ctc_stale_001" })));
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, Date.now());
    let auth: AuthContextValue | null = null;
    let live: SandboxContextValue | null = null;
    function CaptureBoth() {
      auth = useOptionalAuth();
      live = useOptionalSandbox();
      return null;
    }
    render(
      <AuthProvider service={service}>
        <SandboxProvider>
          <CaptureBoth />
        </SandboxProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(live).not.toBeNull());
    const stale = live!.actions;
    act(() => auth!.signOut("user"));
    await waitFor(() => expect(live).toBeNull());

    const results = [
      stale.addContact("@kabirrao"),
      stale.removeContact("@meera"),
      stale.resolveQrIdentity("teenpay://user/@meera?v=1"),
      stale.createQrPayload(),
      stale.startQrPayment("teenpay://user/@meera?v=1"),
      stale.startQrRequest("teenpay://user/@meera?v=1"),
      stale.sendMoney({ recipient: "@meera", amount: 100, idempotencyKey: "snd_stale_qr_1" }),
      stale.createMoneyRequest({ payer: "@meera", amount: 100, idempotencyKey: "prq_stale_qr_1" }),
    ];
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    }
    // Sign-out itself is recorded as a security event; nothing else changed.
    const after = storedDatabase();
    const seeded = buildSeedDatabase();
    expect(after.contacts).toMatchObject([{ contactId: "ctc_stale_001", teenPayId: "meera" }]);
    expect(after.ledger).toEqual(seeded.ledger);
    expect(after.operations).toEqual(seeded.operations);
    expect(after.peerRequests).toEqual([]);
    expect(after.notifications).toEqual(seeded.notifications);
    expect(after.securityEvents.map((e) => e.type)).toEqual(["sign_out"]);
  });
});

describe("routes", () => {
  it("/qr, /qr/scan and /contacts are protected", () => {
    for (const path of ["/qr", "/qr/scan", "/contacts"]) expect(isProtectedRoute(path)).toBe(true);
  });

  it.each(["/qr", "/qr/scan", "/contacts"])("signed out, %s goes to sign-in", async (path) => {
    resetRouter(path);
    render(<TestApp />);
    await waitFor(() => expect(nav.url).toBe(`/sign-in?next=${encodeURIComponent(path)}`));
    expect(screen.queryByRole("img", { name: /TeenPay QR code/ })).not.toBeInTheDocument();
  });
});
