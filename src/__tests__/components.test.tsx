import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ArrowDownLeft } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { AmountDisplay } from "@/components/ui/amount";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/loading";
import { TransactionRow } from "@/components/ui/transaction-row";
import type { Transaction } from "@/domain";

describe("core primitives render", () => {
  it("Button fires clicks and renders as a link when href is set", () => {
    const onClick = vi.fn();
    render(
      <div>
        <Button onClick={onClick}>Continue</Button>
        <Button href="/pay" variant="secondary">
          Go pay
        </Button>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Go pay" })).toHaveAttribute(
      "href",
      "/pay",
    );
  });

  it("IconButton always carries an accessible label", () => {
    render(
      <IconButton label="Close dialog">
        <span aria-hidden>✕</span>
      </IconButton>,
    );

    expect(
      screen.getByRole("button", { name: "Close dialog" }),
    ).toBeInTheDocument();
  });

  it("Input associates its label, hint, and error with the field", () => {
    render(<Input label="Amount" hint="Whole rupees only" />);

    const input = screen.getByLabelText("Amount");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription("Whole rupees only");

    fireEvent.change(input, { target: { value: "500" } });
    expect(input).toHaveValue("500");
  });

  it("Avatar exposes an accessible name", () => {
    render(<Avatar name="Aarav Sharma" initials="AS" />);
    expect(screen.getByRole("img", { name: "Aarav Sharma" })).toHaveTextContent(
      "AS",
    );
  });
});

describe("money renders", () => {
  it("AmountDisplay formats INR with tabular numerals", () => {
    render(<AmountDisplay value={2450} size="display" />);
    expect(screen.getByText("₹2,450")).toBeInTheDocument();
  });

  it("AmountDisplay shows explicit signs for ledger rows", () => {
    render(
      <div>
        <AmountDisplay value={500} signed size="sm" tone="success" />
        <AmountDisplay value={-350} signed size="sm" />
      </div>,
    );

    expect(screen.getByText("+₹500")).toBeInTheDocument();
    expect(screen.getByText("-₹350")).toBeInTheDocument();
  });

  it("TransactionRow renders title, subtitle, and signed amount", () => {
    const transaction: Transaction = {
      id: "t1",
      title: "Pocket money",
      subtitle: "From Meera · Parent",
      amount: 500,
      direction: "in",
      when: "Today, 7:30 pm",
    };

    render(
      <ul>
        <TransactionRow transaction={transaction} icon={ArrowDownLeft} />
      </ul>,
    );

    expect(screen.getByText("Pocket money")).toBeInTheDocument();
    expect(screen.getByText("From Meera · Parent")).toBeInTheDocument();
    expect(screen.getByText("+₹500")).toBeInTheDocument();
  });
});

describe("state components", () => {
  it("Badge, Progress, Skeleton, EmptyState, and ErrorState render", () => {
    render(
      <div>
        <Badge tone="accent">60% saved</Badge>
        <Progress value={60} label="Goal progress" />
        <Skeleton className="h-4 w-24" />
        <EmptyState title="Nothing here yet" description="Keep going." />
        <ErrorState onRetry={() => {}} />
        <ListRow title="Safety & limits" subtitle="Coming soon" />
      </div>,
    );

    expect(screen.getByText("60% saved")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "Goal progress",
    );
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("Safety & limits")).toBeInTheDocument();
  });
});

describe("Modal", () => {
  it("opens with an accessible dialog and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Money spaces">
        <p>Spaces organize your balance.</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Money spaces" })).toBeInTheDocument();
    expect(screen.getByText("Spaces organize your balance.")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
