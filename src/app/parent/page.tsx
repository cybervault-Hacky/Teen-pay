import { PageHeader } from "@/components/layout/page-header";
import { ParentContent } from "@/components/parent/parent-content";
import { RoleGate } from "@/components/sandbox/role-gate";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Parent overview",
  description: "A sandbox preview of how a parent or guardian sees their teen's money.",
};

export default function ParentPage() {
  return (
    <RoleGate role="parent">
      <PageHeader
        title="Overview"
        description="Your teen's money and the family rules you've set."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      <ParentContent />
    </RoleGate>
  );
}
