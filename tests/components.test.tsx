import { fireEvent, render, screen } from "@testing-library/react";
import { Search } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Amount,
  Badge,
  Button,
  EmptyState,
  Input,
  SegmentedControl,
  Switch,
  TransactionRow,
} from "@/components/ui";
import type { Transaction } from "@/domain";

function txFixture(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx_test",
    title: "Monthly pocket money",
    counterparty: { name: "Meera Sharma", kind: "parent" },
    amountPaise: 100_000,
    direction: "in",
    category: "family",
    status: "settled",
    occurredAt: "2026-09-26T09:05:00.000Z",
    source: "ledger",
    ...overrides,
  };
}

describe("Button", () => {
  it("renders its label and handles clicks", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send money</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Send money" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables interaction while loading or disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
    rerender(
      <Button disabled onClick={onClick}>
        Saving
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Saving" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Amount", () => {
  it("renders INR with tabular numerals", () => {
    render(<Amount value={245_000} size="display" />);
    const node = screen.getByText("₹2,450");
    expect(node).toBeInTheDocument();
    expect(node.className).toContain("tnum");
  });

  it("renders signed ledger amounts", () => {
    render(<Amount value={34_900} direction="out" signed />);
    expect(screen.getByText("−₹349")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders status text", () => {
    render(<Badge tone="warning">Pending</Badge>);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders icon, title, body and actions", () => {
    render(
      <EmptyState icon={Search} title="No matches" body="Try another search.">
        <button type="button">Clear</button>
      </EmptyState>,
    );
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.getByText("Try another search.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });
});

describe("Input", () => {
  it("associates label, hint and error accessibly", () => {
    const { rerender } = render(<Input label="Nickname" hint="Shown to family" />);
    const field = screen.getByLabelText("Nickname");
    expect(field).toHaveAccessibleDescription("Shown to family");

    rerender(<Input label="Nickname" error="Required" />);
    expect(screen.getByLabelText("Nickname")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});

describe("TransactionRow", () => {
  it("renders title, counterparty and signed amount", () => {
    render(<TransactionRow transaction={txFixture()} />);
    expect(screen.getByText("Monthly pocket money")).toBeInTheDocument();
    expect(screen.getByText(/Meera Sharma/)).toBeInTheDocument();
    expect(screen.getByText("+₹1,000")).toBeInTheDocument();
  });

  it("acts as a button when selectable", () => {
    const onSelect = vi.fn();
    const tx = txFixture({ id: "tx_shop", title: "Crossword Bookstore", direction: "out" });
    render(<TransactionRow transaction={tx} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Crossword Bookstore/ }));
    expect(onSelect).toHaveBeenCalledWith(tx);
  });

  it("flags pending transactions", () => {
    render(<TransactionRow transaction={txFixture({ status: "pending" })} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("announces request rows for screen readers", () => {
    render(
      <TransactionRow
        transaction={txFixture({
          title: "Money request",
          source: "request",
          requestId: "req_1",
          status: "pending",
        })}
      />,
    );
    expect(screen.getByText("Money request")).toBeInTheDocument();
  });
});

describe("SegmentedControl", () => {
  it("selects one option at a time", () => {
    function Harness() {
      const [value, setValue] = useState("all");
      return (
        <SegmentedControl
          label="Filter"
          value={value}
          onChange={setValue}
          options={[
            { value: "all", label: "All" },
            { value: "in", label: "In" },
          ]}
        />
      );
    }
    render(<Harness />);
    const all = screen.getByRole("button", { name: "All" });
    const incoming = screen.getByRole("button", { name: "In" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(incoming);
    expect(incoming).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Switch", () => {
  it("toggles with an accessible switch role", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onChange={onChange} label="Dark mode" />,
    );
    const control = screen.getByRole("switch", { name: "Dark mode" });
    expect(control).toHaveAttribute("aria-checked", "false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Switch checked onChange={onChange} label="Dark mode" />);
    expect(screen.getByRole("switch", { name: "Dark mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
