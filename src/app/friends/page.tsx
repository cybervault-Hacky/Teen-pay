import { Suspense } from "react";
import { FriendsClient } from "@/components/friends/friends-client";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Friend Circle",
  description: "Your trusted TeenPay peers — private to you.",
};

export default function FriendsPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <FriendsClient />
      </Suspense>
    </RoleGate>
  );
}
