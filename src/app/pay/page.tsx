import { Suspense } from "react";
import { PayClient } from "@/components/pay/pay-client";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Pay",
  description: "Send money or request money in the sandbox.",
};

export default function PayPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <PayClient />
      </Suspense>
    </RoleGate>
  );
}
