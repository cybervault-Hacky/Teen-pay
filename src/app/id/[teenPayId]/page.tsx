import { IdentityDetail } from "@/components/identity/identity-detail";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "TeenPay ID",
  description: "A TeenPay identity — public profile and safe actions only.",
};

/**
 * One identity, one surface. The TeenPay ID in the URL only picks who
 * to look up through the centralized identity engine; everything shown
 * is the signed-in teen's own safe view — public profile and
 * relationship state, never private data. The parameter is validated
 * in the component before any lookup, and can never be interpreted as
 * an internal account id. Not a public profile page: unreachable
 * without a session.
 */
export default async function IdentityDetailPage({
  params,
}: {
  params: Promise<{ teenPayId: string }>;
}) {
  const { teenPayId } = await params;
  return (
    <RoleGate role="teen">
      <IdentityDetail teenPayId={decodeURIComponent(teenPayId)} />
    </RoleGate>
  );
}
