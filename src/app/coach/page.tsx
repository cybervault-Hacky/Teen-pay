import { CoachContent } from "@/components/coach/coach-content";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Money Coach",
  description: "A read-only look at your own money: what came in, what went out and how your goals are doing.",
};

export default function CoachPage() {
  return (
    <RoleGate role="teen">
      <CoachContent />
    </RoleGate>
  );
}
