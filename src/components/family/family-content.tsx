"use client";

import { roleLabel } from "@/domain";
import { selectSession } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ParentFamilyView } from "./parent-family-view";
import { TeenFamilyView } from "./teen-family-view";

/** /family — one route, the teen's or the guardian's perspective. */
export function FamilyContent() {
  const { state } = useSandbox();
  const { role, user } = selectSession(state);
  return (
    <>
      <PageHeader
        title="Family"
        description={
          role === "teen"
            ? "Your family connection and money rules."
            : "Connect with your teen and manage your family."
        }
        actions={
          <Badge tone="warning" aria-label={`Sandbox, viewing as ${user.displayName}, ${roleLabel(role)}`}>
            Sandbox · {roleLabel(role)}
          </Badge>
        }
      />
      {role === "teen" ? <TeenFamilyView /> : <ParentFamilyView />}
    </>
  );
}
