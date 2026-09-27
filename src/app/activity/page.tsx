import { ActivityFeed } from "@/components/activity/activity-feed";
import { PageHeader } from "@/components/layout/page-header";
import { RoleGate } from "@/components/sandbox/role-gate";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Activity",
  description: "Everything that happens with your money.",
};

export default function ActivityPage() {
  return (
    <RoleGate role="teen">
      <PageHeader
        title="Activity"
        description="Everything that happens with your money."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      <ActivityFeed />
    </RoleGate>
  );
}
