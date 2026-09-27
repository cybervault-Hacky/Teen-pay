import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="This page doesn't exist"
        description="The link may be old, or the page may have moved."
        action={<Button href="/">Go home</Button>}
      />
    </Card>
  );
}
