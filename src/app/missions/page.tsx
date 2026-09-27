import { MissionsContent } from "@/components/missions/missions-content";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Money Missions",
  description: "Short, optional lessons and challenges about your own money.",
};

export default function MissionsPage() {
  return (
    <RoleGate role="teen">
      <MissionsContent />
    </RoleGate>
  );
}
