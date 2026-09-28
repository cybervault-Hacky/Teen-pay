import { FriendDetail } from "@/components/friends/friend-detail";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Friend",
  description: "A trusted peer in your Friend Circle.",
};

/**
 * A friend's page. The TeenPay ID in the URL only picks who to look
 * up through the directory; everything shown is the signed-in teen's
 * own relationship view — public profile and status, never private
 * data. Not a public profile page: unreachable without a session.
 */
export default async function FriendPage({ params }: { params: Promise<{ teenPayId: string }> }) {
  const { teenPayId } = await params;
  return (
    <RoleGate role="teen">
      <FriendDetail teenPayId={decodeURIComponent(teenPayId)} />
    </RoleGate>
  );
}
