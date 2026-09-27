import { HomeContent } from "@/components/home/home-content";
import { RoleGate } from "@/components/sandbox/role-gate";

export default function HomePage() {
  return (
    <RoleGate role="teen">
      <HomeContent />
    </RoleGate>
  );
}
