import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParentContent } from "@/components/parent/parent-content";
import { SandboxProvider } from "@/sandbox/store";
import { SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { linkedDatabase, preloadDatabase, storedDatabase } from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/parent",
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

function renderCenter(db: SandboxDatabase = linkedDatabase()) {
  preloadDatabase(db);
  const before = window.localStorage.getItem("teenpay-sandbox-v1");
  const view = render(
    <SandboxProvider viewerId={SEED_PARENT_ID}>
      <ParentContent />
    </SandboxProvider>,
  );
  return { view, before };
}

/** Internal ids are plumbing — a parent sees handles and names, never ids. */
const INTERNAL_ID = /\b(usr|wal|fam|spc|apr|op|evt|prq|snd|fnd|msn|req|shd)_[a-z0-9_-]+/i;

describe("parent control center privacy", () => {
  it("shows the permitted summary and nothing from teen-private areas", () => {
    renderCenter();

    // Permitted: identity, aggregate money, handle.
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("@aarav")).toBeInTheDocument();
    expect(screen.getByText("₹1,850")).toBeInTheDocument();
    expect(screen.getByText(/₹4,150 total/i)).toBeInTheDocument();

    // The rendered tree carries no internal identifiers at all.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(INTERNAL_ID);
    expect(text).not.toContain(SEED_TEEN_ID);
    expect(text).not.toContain(SEED_PARENT_ID);
  });

  it("shows Money Spaces as one aggregate — never space names or balances", () => {
    renderCenter();

    // The aggregate is shown exactly once in the summary line.
    expect(screen.getByText(/in money spaces: ₹2,300/i)).toBeInTheDocument();
    // No individual Space leaks into the parent view.
    expect(screen.queryByText("New Bike")).not.toBeInTheDocument();
    expect(screen.queryByText(/spc_/i)).not.toBeInTheDocument();
  });

  it("states the privacy boundary plainly, instead of hiding it", () => {
    renderCenter();
    expect(
      screen.getByText(/money coach, missions, friend circles and the safety shield stay private/i),
    ).toBeInTheDocument();
  });

  it("renders teen-private strings nowhere, even as fragments", () => {
    renderCenter();
    const html = document.body.innerHTML.toLowerCase();
    // No raw ledger rows, QR history, searches, or shield history.
    for (const forbidden of [
      "ledger",
      "qr code",
      "scan history",
      "search history",
      "warning history",
      "friend request",
      "mission progress",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("reading the center never writes the database", async () => {
    const { before } = renderCenter();
    await waitFor(() => expect(screen.getByText("Aarav Sharma")).toBeInTheDocument());
    // Give effects a tick, then compare byte-for-byte.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(window.localStorage.getItem("teenpay-sandbox-v1")).toBe(before);
  });

  it("saving rules touches only the family's controls — never ledger, spaces or derived data", async () => {
    const user = userEvent.setup();
    const db = linkedDatabase();
    renderCenter(db);
    const before = storedDatabase();

    await user.click(screen.getByRole("button", { name: /edit rules/i }));
    const dialog = screen.getByRole("dialog", { name: "Spending rules" });
    await user.click(within(dialog).getByRole("switch", { name: /ask me first/i }));
    const amount = within(dialog).getByLabelText("Approval amount");
    await user.clear(amount);
    await user.type(amount, "750");
    await user.click(within(dialog).getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const after = storedDatabase();
    // Money, operations, spaces, schedules: untouched.
    expect(after.ledger).toEqual(before.ledger);
    expect(after.operations).toEqual(before.operations);
    expect(after.spaces).toEqual(before.spaces);
    expect(after.pocketMoneySchedules).toEqual(before.pocketMoneySchedules);
    expect(after.peerRequests).toEqual(before.peerRequests);
    // The change landed exactly where it belongs: the family's controls.
    const controlsOf = (dbase: SandboxDatabase) =>
      dbase.families.find((f) => f.members.some((m) => m.accountId === SEED_TEEN_ID))!.controls;
    expect(controlsOf(after)).not.toEqual(controlsOf(before));
    expect(controlsOf(after).find((c) => c.teenId === SEED_TEEN_ID)?.approval.threshold).toBe(750);
  });
});
