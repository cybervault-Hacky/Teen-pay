import { PageHeader } from "@/components/layout/page-header";
import { ParentContent } from "@/components/parent/parent-content";
import { RoleGate } from "@/components/sandbox/role-gate";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Parent Control Center",
  description: "Manage your family's TeenPay — controls, approvals and pocket money in one calm place.",
};

export default function ParentPage() {
  return (
    <RoleGate role="parent">
      <PageHeader
        title="Overview"
        description="Your family's control center — approvals, rules and pocket money, on top of the same rules your teen sees."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      <ParentContent />
    </RoleGate>
  );
}
