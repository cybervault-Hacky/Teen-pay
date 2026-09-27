import { Suspense } from "react";
import { PeerClient } from "@/components/peer/send-client";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Request money",
  description: "Ask another TeenPay teen for sandbox money.",
};

export default function RequestPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <PeerClient mode="request" />
      </Suspense>
    </RoleGate>
  );
}
