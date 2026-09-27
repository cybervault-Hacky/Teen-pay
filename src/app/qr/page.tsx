import { Suspense } from "react";
import { MyQr } from "@/components/qr/my-qr";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "My TeenPay QR",
  description: "Your TeenPay ID as a QR code, so another teen can pay or request from you.",
};

export default function MyQrPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <MyQr />
      </Suspense>
    </RoleGate>
  );
}
