import { Suspense } from "react";
import { RequestsCenter } from "@/components/peer/requests-center";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Requests",
  description: "Money requests you've received and sent in the sandbox.",
};

export default function RequestsPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <RequestsCenter />
      </Suspense>
    </RoleGate>
  );
}
