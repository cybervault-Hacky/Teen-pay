import { Suspense } from "react";
import { IdentityClient } from "@/components/identity/identity-client";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "TeenPay ID",
  description: "Your TeenPay ID — the simple way teens find each other.",
};

/**
 * The TeenPay ID home: your own identity (copy, share, change) and the
 * canonical exact-match lookup. Teen-only — identity features belong
 * to the teens whose identities they are.
 */
export default function IdentityPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <IdentityClient />
      </Suspense>
    </RoleGate>
  );
}
