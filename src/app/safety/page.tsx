import { Suspense } from "react";
import { ShieldPage } from "@/components/safety-shield/shield-page";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Safety Shield",
  description: "You're in control — what TeenPay pauses and reviews for.",
};

export default function SafetyPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <ShieldPage />
      </Suspense>
    </RoleGate>
  );
}
