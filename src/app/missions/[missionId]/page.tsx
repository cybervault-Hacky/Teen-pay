import { MissionDetail } from "@/components/missions/mission-detail";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Money Mission",
  description: "One Money Mission: what it teaches, its steps and your progress.",
};

/**
 * A mission's page. The id in the URL only picks a public catalog
 * entry; the progress shown is always the signed-in teen's own.
 */
export default async function MissionPage({ params }: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await params;
  return (
    <RoleGate role="teen">
      <MissionDetail missionId={decodeURIComponent(missionId)} />
    </RoleGate>
  );
}
