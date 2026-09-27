import { MoneyContent } from "@/components/money/money-content";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Money",
  description: "How your money is set aside, derived from the ledger.",
};

export default function MoneyPage() {
  return (
    <RoleGate role="teen">
      <MoneyContent />
    </RoleGate>
  );
}
