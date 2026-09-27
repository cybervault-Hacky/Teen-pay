import { Suspense } from "react";
import { ScanClient } from "@/components/qr/scan-client";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Scan to pay",
  description: "Scan another teen's TeenPay QR to pay or request sandbox money.",
};

export default function ScanPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <ScanClient />
      </Suspense>
    </RoleGate>
  );
}
