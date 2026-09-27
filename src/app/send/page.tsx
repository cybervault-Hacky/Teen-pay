import { Suspense } from "react";
import { PeerClient } from "@/components/peer/send-client";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Send money",
  description: "Send sandbox money to another TeenPay teen.",
};

export default function SendPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <PeerClient mode="send" />
      </Suspense>
    </RoleGate>
  );
}
