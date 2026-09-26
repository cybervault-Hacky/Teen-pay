import Link from "next/link";
import { Compass } from "lucide-react";
import { Container } from "@/components/shell";
import { buttonClassName, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <Container width="narrow">
      <div className="pt-10">
        <EmptyState
          icon={Compass}
          title="Page not found"
          body="This page moved or never existed. Let's get you back home."
        >
          <Link href="/" className={buttonClassName({ variant: "primary" })}>
            Go home
          </Link>
        </EmptyState>
      </div>
    </Container>
  );
}
