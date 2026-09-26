"use client";

import { Container } from "@/components/shell";
import { ErrorState } from "@/components/ui";

export interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Route-level error boundary with recovery. */
export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <Container width="narrow">
      <div className="pt-10">
        <ErrorState
          title="This page hit a snag"
          body="Don't worry — your money isn't going anywhere. Try loading the page again."
          onRetry={reset}
        />
      </div>
    </Container>
  );
}
