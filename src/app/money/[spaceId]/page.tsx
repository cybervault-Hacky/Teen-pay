import { RoleGate } from "@/components/sandbox/role-gate";
import { SpaceDetail } from "@/components/spaces/space-detail";

export const metadata = {
  title: "Money Space",
  description: "One Money Space: balance, progress and history, derived from the ledger.",
};

/**
 * A Money Space's page. The id comes from the URL; whether the
 * signed-in account may see it is decided by its scope (only the
 * owner's own Spaces are ever in it), never by the URL.
 */
export default async function SpacePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  return (
    <RoleGate role="teen">
      <SpaceDetail spaceId={decodeURIComponent(spaceId)} />
    </RoleGate>
  );
}
