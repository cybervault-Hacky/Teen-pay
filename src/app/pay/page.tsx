import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/shell";
import { Skeleton } from "@/components/ui";
import { PayContent } from "./PayContent";

export const metadata: Metadata = { title: "Pay" };

function PayFallback() {
  return (
    <Container width="narrow">
      <div className="flex flex-col gap-6 pt-5 sm:pt-8" aria-label="Loading">
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
      </div>
    </Container>
  );
}

/** Pay — send to, or request from, people you trust. */
export default function PayPage() {
  return (
    <Suspense fallback={<PayFallback />}>
      <PayContent />
    </Suspense>
  );
}
