import { Suspense } from "react";
import { MoneyContent } from "@/components/money/money-content";
import { MoneyScreen } from "@/components/missions/mission-screens";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Money",
  description: "How your money is set aside, derived from the ledger.",
};

export default function MoneyPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={<MoneyContent />}>
        <MoneyScreen />
      </Suspense>
    </RoleGate>
  );
}
