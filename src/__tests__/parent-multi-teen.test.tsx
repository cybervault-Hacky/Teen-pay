import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { ParentContent } from "@/components/parent/parent-content";
import { createAccount } from "@/sandbox/accounts";
import { defaultGuardianControls } from "@/domain";
import type { FamilyMembership, GuardianLink, User } from "@/domain";
import {
  acceptInviteTransition,
  claimInviteTransition,
  createInviteTransition,
} from "@/sandbox/family-transitions";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { SEED_FAMILY_ID, SEED_PARENT_ID } from "@/sandbox/seed";
import { SandboxProvider } from "@/sandbox/store";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, linkedDatabase, linkedState, preloadDatabase, SANDBOX_KEY } from "./helpers/fixtures";
import { resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
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

function renderAs(viewerId: string) {
  render(
    <SandboxProvider viewerId={viewerId}>
      <ParentContent />
    </SandboxProvider>,
  );
}

/** Real sign-in stack for accounts outside the seed database. */
async function signedInParent(accountId: string) {
  const service = createSandboxAuthService();
  await service.signIn({ method: "sandbox", accountId, role: "parent" }, Date.now());
  resetRouter("/parent");
  const view = render(<TestApp service={service} />);
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
  return view;
}

afterEach(() => {
  window.localStorage.removeItem(SANDBOX_KEY);
});

/** A second family: Rohan (teen) linked to Sunita (parent). */
function secondFamilyDatabase(): { db: SandboxDatabase; rohanId: string; sunitaId: string } {
  let db = linkedDatabase();
  const rohan = createAccount(db, { role: "teen", displayName: "Rohan Verma", username: "rohan" }, AT);
  if ("code" in rohan) throw new Error("rohan create failed");
  db = rohan.db;
  const sunita = createAccount(db, { role: "parent", displayName: "Sunita Verma", username: "sunita" }, AT);
  if ("code" in sunita) throw new Error("sunita create failed");
  db = sunita.db;
  const run = (
    actorId: string,
    fn: (s: SandboxState) => { state: SandboxState; result: { ok: boolean } },
    familyId?: string,
  ) => {
    const scope = scopeFor(db, actorId, familyId ? { familyId } : {});
    if (!scope) throw new Error(`no scope for ${actorId}`);
    const out = fn(scope.state);
    if (!out.result.ok) throw new Error(`transition failed: ${JSON.stringify(out.result)}`);
    db = mergeScope(db, scope.info, scope.state, out.state);
  };
  const rohanFamilyId = db.families.find((f) =>
    f.members.some((m) => m.accountId === rohan.account.id && m.role === "teen"),
  )!.id;
  run(rohan.account.id, (s) => createInviteTransition(s, { actorId: rohan.account.id, at: AT, code: "TEEN-7777" }));
  run(sunita.account.id, (s) => claimInviteTransition(s, { actorId: sunita.account.id, at: AT, code: "TEEN-7777" }), rohanFamilyId);
  run(sunita.account.id, (s) => acceptInviteTransition(s, { actorId: sunita.account.id, at: AT, teenId: rohan.account.id }), rohanFamilyId);
  return { db, rohanId: rohan.account.id, sunitaId: sunita.account.id };
}

/** The linked seed state plus a second teen linked to Priya. */
function twoTeenState(): SandboxState {
  const rohan: User = {
    id: "usr_rohan",
    role: "teen",
    identifier: "sandbox:rohan",
    name: "Rohan Verma",
    displayName: "Rohan",
    username: "rohan",
    avatarInitials: "RV",
    status: "active",
    identitySource: "sandbox",
    createdAt: AT,
    updatedAt: AT,
  };
  const membership: FamilyMembership = {
    id: "mem_rohan",
    familyId: SEED_FAMILY_ID,
    accountId: rohan.id,
    role: "teen",
    status: "active",
    createdAt: AT,
    updatedAt: AT,
  };
  const link: GuardianLink = {
    teenId: rohan.id,
    status: "linked",
    guardianId: SEED_PARENT_ID,
    inviteId: null,
    linkedAt: AT,
    updatedAt: AT,
  };
  const state = linkedState();
  return {
    ...state,
    users: [...state.users, rohan],
    family: {
      ...state.family,
      members: [...state.family.members, membership],
      links: [...state.family.links, link],
      controls: [...state.family.controls, defaultGuardianControls(rohan.id, SEED_PARENT_ID, AT)],
    },
    // Rohan's wallet is intentionally not in this scope: his money
    // figures must be labelled "not in view", never faked.
  };
}

describe("multi-teen control center", () => {
  it("offers a switcher over linked teens only, and it drives every selector", async () => {
    const user = userEvent.setup();
    preloadDatabase(twoTeenState());
    renderAs(SEED_PARENT_ID);

    const switcher = screen.getByRole("group", { name: "Choose a teen to manage" });
    const aaravButton = within(switcher).getByRole("button", { name: /aarav · @aarav/i });
    const rohanButton = within(switcher).getByRole("button", { name: /rohan · @rohan/i });
    expect(aaravButton).toHaveAttribute("aria-pressed", "true");
    expect(rohanButton).toHaveAttribute("aria-pressed", "false");

    // Default selection: Aarav, with his real figures.
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("₹1,850")).toBeInTheDocument();

    // Switching re-renders the whole center for Rohan.
    await user.click(rohanButton);
    expect(rohanButton).toHaveAttribute("aria-pressed", "true");
    expect(aaravButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Rohan Verma")).toBeInTheDocument();
    expect(screen.queryByText("₹1,850")).not.toBeInTheDocument();
    // No wallet in scope: honest copy, no faked zeros.
    expect(
      screen.getByText(/money details aren't in view for rohan/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/₹0 total/i)).not.toBeInTheDocument();
    // Activity: nothing to show, plainly.
    expect(screen.getByText("Nothing to show yet.")).toBeInTheDocument();

    // Switching back restores Aarav's view exactly.
    await user.click(aaravButton);
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("₹1,850")).toBeInTheDocument();
  });

  it("a single-teen family gets no switcher at all", () => {
    preloadDatabase(linkedState());
    renderAs(SEED_PARENT_ID);
    expect(
      screen.queryByRole("group", { name: "Choose a teen to manage" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
  });
});

describe("cross-teen isolation in the UI", () => {
  it("Priya sees Aarav only — Rohan (linked to Sunita) never appears", () => {
    const { db, sunitaId } = secondFamilyDatabase();
    void sunitaId;
    preloadDatabase(db);
    renderAs(SEED_PARENT_ID);

    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.queryByText("Rohan Verma")).not.toBeInTheDocument();
    expect(screen.queryByText("@rohan")).not.toBeInTheDocument();
  });

  it("Sunita sees Rohan only — Aarav's name, handle and money never appear", async () => {
    const { db, sunitaId } = secondFamilyDatabase();
    preloadDatabase(db);
    const view = await signedInParent(sunitaId);

    expect(screen.getByText("Rohan Verma")).toBeInTheDocument();
    expect(screen.getByText("@rohan")).toBeInTheDocument();
    expect(screen.queryByText("Aarav Sharma")).not.toBeInTheDocument();
    expect(screen.queryByText("@aarav")).not.toBeInTheDocument();
    expect(screen.queryByText("₹1,850")).not.toBeInTheDocument();
    expect(screen.queryByText(/₹4,150 total/i)).not.toBeInTheDocument();
    view.unmount();
    cleanup();
  });

  it("the family card lists only the viewer's own family", async () => {
    const { db, sunitaId } = secondFamilyDatabase();
    preloadDatabase(db);
    const view = await signedInParent(sunitaId);

    const familySection = screen.getByRole("region", { name: "Family" });
    expect(within(familySection).getByText(/^rohan/i)).toBeInTheDocument();
    expect(within(familySection).queryByText(/aarav/i)).not.toBeInTheDocument();
    expect(within(familySection).queryByText(/priya/i)).not.toBeInTheDocument();
    view.unmount();
    cleanup();
  });
});

describe("the parent identity in the greeting", () => {
  it("greets the signed-in parent, from the projection", () => {
    preloadDatabase(linkedState());
    renderAs(SEED_PARENT_ID);
    expect(screen.getByText(/hello, priya/i)).toBeInTheDocument();
  });
});
