import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyContent } from "@/components/family/family-content";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ParentContent } from "@/components/parent/parent-content";
import { PayFlow } from "@/components/pay/pay-flow";
import { ProfileContent } from "@/components/profile/profile-content";
import { RoleGate } from "@/components/sandbox/role-gate";
import { RoleSwitcher } from "@/components/sandbox/role-switcher";
import { buildSeedState, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SandboxProvider, useSandbox } from "@/sandbox/store";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import {
  linkedState,
  preloadDatabase,
  storedDatabase,
  teenLedger,
  withRules,
} from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/family",
  useSearchParams: () => new URLSearchParams(),
}));

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

// Daily limits use the real clock here (faking Date stalls motion
// exits). Every seed debit predates 26 Sep 2026, so "today" starts
// at ₹0 spent. Engine-level date logic is pinned in
// guardian-controls.test.ts.

// Phase 4: data is stored as a v3 database; who is viewing comes
// from the session (here, the provider's `viewerId`), not the data.
let viewer: string = SEED_TEEN_ID;
beforeEach(() => {
  viewer = SEED_TEEN_ID;
});

function preload(state: SandboxState | SandboxDatabase, as: "teen" | "parent" = "teen") {
  viewer = as === "parent" ? SEED_PARENT_ID : SEED_TEEN_ID;
  preloadDatabase(state);
}

/** Ledger-derived spendable balance + counts, as queryable text. */
function Probe() {
  const { state } = useSandbox();
  // Phase 5: a parent's view also holds their own wallet — probe the teen's.
  const ledger = teenLedger(state);
  const spend = ledger.reduce(
    (sum, e) => (e.direction === "credit" ? sum + e.amount : sum - e.amount),
    0,
  );
  return (
    <div>
      <span data-testid="spend">{spend}</span>
      <span data-testid="ledger">{ledger.length}</span>
      <span data-testid="approvals">
        {state.approvals.map((a) => a.status).join(",")}
      </span>
    </div>
  );
}

const probe = (id: string) =>
  document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";

function renderWith(ui: React.ReactNode) {
  return render(
    <SandboxProvider viewerId={viewer}>
      <Probe />
      {ui}
    </SandboxProvider>,
  );
}

describe("role switcher", () => {
  it("switches the sandbox role without touching family or ledger", async () => {
    const user = userEvent.setup();
    renderWith(<RoleSwitcher />);
    // Phase 4: an unconnected parent can't see the teen's wallet, so
    // "untouched" is checked on the stored wallet, not the view.
    const ledgerBefore = teenLedger(storedDatabase()).length;

    const group = screen.getByRole("group", { name: /sandbox role/i });
    const teen = within(group).getByRole("button", { name: /teen/i });
    const parent = within(group).getByRole("button", { name: /parent/i });
    expect(teen).toHaveAttribute("aria-pressed", "true");
    expect(parent).toHaveAttribute("aria-pressed", "false");

    await user.click(parent);
    expect(parent).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/priya/i);
    expect(teenLedger(storedDatabase()).length).toBe(ledgerBefore);
  });

  it("is labelled as a demo control in Profile, next to reset", () => {
    renderWith(<ProfileContent />);
    expect(screen.getByText(/a demo control, not sign-in/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Family" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Money controls" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sandbox" })).toBeInTheDocument();
    expect(screen.getByText("Reset sandbox data")).toBeInTheDocument();
  });
});

describe("family linking UI", () => {
  it("teen invites, parent enters the code, reviews, and connects", async () => {
    const user = userEvent.setup();
    renderWith(
      <>
        <RoleSwitcher />
        <FamilyContent />
      </>,
    );

    // Teen: not linked, with a supportive explanation.
    expect(screen.getByText("Parent not connected")).toBeInTheDocument();
    expect(
      screen.getByText(/connect a parent or guardian to unlock family controls/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /connect parent/i }));
    expect(screen.getByText("Invitation created")).toBeInTheDocument();
    const code = screen.getByText(/^TEEN-\d{4}$/).textContent ?? "";
    expect(code).toMatch(/^TEEN-\d{4}$/);

    // Parent: enter the code (lowercase, no dash — it's normalized).
    await user.click(screen.getByRole("button", { name: /parent/i, pressed: false }));
    expect(screen.getByRole("heading", { name: "Add teen" })).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Invite code"),
      code.toLowerCase().replace("-", ""),
    );
    await user.click(screen.getByRole("button", { name: /find teen/i }));

    // Review the teen before connecting.
    expect(screen.getByRole("heading", { name: "Review teen" })).toBeInTheDocument();
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText(/not verified/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(screen.getByRole("heading", { name: "Connected" })).toBeInTheDocument();

    // Teen now sees the linked guardian and the rules card.
    await user.click(screen.getByRole("button", { name: /teen/i, pressed: false }));
    expect(
      screen.getByText("Priya is connected as your parent/guardian."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your money rules" })).toBeInTheDocument();
  });

  it("disconnect asks first, and keeps ledger history", async () => {
    const user = userEvent.setup();
    preload(linkedState());
    renderWith(<FamilyContent />);
    const ledgerBefore = probe("ledger");

    await user.click(screen.getByRole("button", { name: /disconnect parent/i }));
    const dialog = screen.getByRole("dialog", { name: "Disconnect parent?" });
    expect(within(dialog).getByText(/history/i)).toBeInTheDocument();

    // Escape closes without changing anything.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Priya is connected as your parent/guardian.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /disconnect parent/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^disconnect$/i }),
    );
    expect(screen.getByText("Parent disconnected")).toBeInTheDocument();
    expect(probe("ledger")).toBe(ledgerBefore);
  });
});

describe("teen family view", () => {
  it("shows every rule, the remaining daily limit, and the allowance plan", () => {
    preload(withRules({ daily: 500, perTx: 1000, threshold: 500 }));
    renderWith(<FamilyContent />);
    expect(screen.getByText("₹500 a day")).toBeInTheDocument();
    expect(screen.getByText(/₹500 left/)).toBeInTheDocument();
    expect(screen.getByText("Up to ₹1,000 per payment")).toBeInTheDocument();
    expect(
      screen.getByText("Payments above ₹500 need Priya's approval"),
    ).toBeInTheDocument();
    expect(screen.getByText("No schedule set")).toBeInTheDocument();
  });
});

describe("parent dashboard", () => {
  it("asks an unlinked parent to connect a teen first", () => {
    preload(buildSeedState(), "parent");
    renderWith(<ParentContent />);
    expect(screen.getByText("No teen connected yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add a teen/i })).toHaveAttribute(
      "href",
      "/family",
    );
  });

  it("shows the teen overview and edits spending limits", async () => {
    const user = userEvent.setup();
    preload(linkedState(), "parent");
    renderWith(<ParentContent />);

    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("@aarav")).toBeInTheDocument();
    expect(screen.getByText("No daily limit")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edit rules/i }));
    const dialog = screen.getByRole("dialog", { name: "Spending rules" });
    await user.click(within(dialog).getByRole("switch", { name: "Daily limit" }));
    const daily = within(dialog).getByLabelText("Daily limit amount");
    await user.clear(daily);
    await user.type(daily, "500");
    await user.click(within(dialog).getByRole("switch", { name: "Ask me first" }));
    await user.click(within(dialog).getByRole("button", { name: /save rules/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("₹500 a day")).toBeInTheDocument();
    expect(screen.getByText("You approve payments above ₹500")).toBeInTheDocument();
    expect(screen.getAllByText(/spending rules saved/i).length).toBeGreaterThan(0);
  });

  it("rejects an invalid rule with the engine's message", async () => {
    const user = userEvent.setup();
    preload(linkedState(), "parent");
    renderWith(<ParentContent />);
    await user.click(screen.getByRole("button", { name: /edit rules/i }));
    const dialog = screen.getByRole("dialog", { name: "Spending rules" });
    await user.click(within(dialog).getByRole("switch", { name: "Per-payment limit" }));
    const perTx = within(dialog).getByLabelText("Per-payment limit amount");
    await user.clear(perTx);
    await user.type(perTx, "20000");
    await user.click(within(dialog).getByRole("button", { name: /save rules/i }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /per-payment limit between ₹1 and ₹10,000/i,
    );
  });

  // Phase 7: "Set schedule" became "Create pocket money" — a real
  // schedule with a fuller preview. Same guarantees: the preview
  // shows amount, cadence and the next Monday; saving shows the plan;
  // no money moves.
  it("previews a weekly pocket-money schedule", async () => {
    const user = userEvent.setup();
    preload(linkedState(), "parent");
    renderWith(<ParentContent />);
    expect(screen.getByText("No pocket money scheduled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create pocket money/i }));
    const dialog = screen.getByRole("dialog", { name: "Create pocket money" });
    const preview = within(dialog).getByRole("region", { name: "Preview" });
    expect(preview).toHaveTextContent("₹500");
    expect(preview).toHaveTextContent("Every Monday");
    expect(preview).toHaveTextContent("Priya's wallet");
    expect(preview).toHaveTextContent("Aarav's wallet");
    expect(preview).toHaveTextContent(/First transfer\s*Mon, /);
    expect(preview).toHaveTextContent(/Nothing moves now/);
    await user.click(within(dialog).getByRole("button", { name: /create pocket money/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const section = screen.getByRole("region", { name: "Pocket money" });
    expect(within(section).getByText("Pocket money to Aarav")).toBeInTheDocument();
    expect(within(section).getByText("Every Monday")).toBeInTheDocument();
    expect(within(section).getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/Pocket money scheduled: ₹500 every Monday/)).toBeInTheDocument();
    // A schedule is a plan: no money moved.
    expect(probe("spend")).toBe("1850");
  });
});

describe("payments with guardian controls", () => {
  it("blocks a payment over today's limit before review", async () => {
    const user = userEvent.setup();
    preload(withRules({ daily: 500 }));
    renderWith(<PayFlow mode="send" />);
    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    await user.type(await screen.findByLabelText("Amount"), "600");
    expect(
      screen.getByText(/this payment would exceed today's spending limit/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(probe("spend")).toBe("1850");
  });

  it("routes a payment above the threshold to approval, then the parent approves once", async () => {
    const user = userEvent.setup();
    preload(withRules({ daily: 500, threshold: 500 }));
    const view = renderWith(<PayFlow mode="send" />);

    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    await user.type(await screen.findByLabelText("Amount"), "750");
    expect(screen.getByText(/this payment needs parent approval/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("Approval required")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ask priya to approve/i }));
    expect(
      await screen.findByRole("heading", { name: /pending approval/i }),
    ).toBeInTheDocument();
    expect(probe("spend")).toBe("1850"); // nothing moved
    expect(probe("approvals")).toBe("pending");
    view.unmount();

    // Parent side (state persisted through localStorage).
    const stored = storedDatabase();
    preload(stored, "parent");
    renderWith(<ParentContent />);
    expect(screen.getByText(/aarav wants to send/i)).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Approve ₹750 to Riya Patel" });
    expect(screen.getByRole("button", { name: "Decline ₹750 to Riya Patel" })).toBeInTheDocument();
    await user.dblClick(approve);

    expect(probe("spend")).toBe("1100"); // exactly once
    expect(probe("approvals")).toBe("approved");
    expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0);
  });

  it("declining moves no money and notifies the teen", async () => {
    const user = userEvent.setup();
    let s: SandboxState | SandboxDatabase = withRules({ threshold: 500 });
    // Create the approval through the store API on the teen side.
    preload(s);
    function Requester() {
      const { actions } = useSandbox();
      return (
        <button
          type="button"
          onClick={() =>
            actions.pay({ idempotencyId: "pay_decline", recipientId: "rec_riya", amount: 750 })
          }
        >
          request
        </button>
      );
    }
    const view = renderWith(<Requester />);
    await user.click(screen.getByRole("button", { name: "request" }));
    view.unmount();
    s = storedDatabase();

    preload(s, "parent");
    const parentView = renderWith(<ParentContent />);
    await user.click(screen.getByRole("button", { name: "Decline ₹750 to Riya Patel" }));
    expect(probe("spend")).toBe("1850");
    expect(probe("approvals")).toBe("declined");
    parentView.unmount();

    s = storedDatabase();
    preload(s, "teen");
    renderWith(<NotificationBell />);
    await user.click(screen.getByRole("button", { name: /notifications, \d+ unread/i }));
    const dialog = screen.getByRole("dialog", { name: "Notifications" });
    expect(within(dialog).getByText("Payment not approved")).toBeInTheDocument();
    expect(within(dialog).getByText(/no money moved/i)).toBeInTheDocument();
  });
});

describe("role gate", () => {
  it("explains a teen-only screen to the parent and offers a transparent switch", async () => {
    const user = userEvent.setup();
    preload(linkedState(), "parent");
    renderWith(
      <RoleGate role="teen">
        <p>Teen home</p>
      </RoleGate>,
    );
    expect(screen.queryByText("Teen home")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /switch to teen/i }));
    expect(screen.getByText("Teen home")).toBeInTheDocument();
  });
});
