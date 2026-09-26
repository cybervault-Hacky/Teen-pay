import { Container } from "@/components/shell";
import { Skeleton } from "@/components/ui";

/** Route-level loading state — skeleton of the home layout. */
export default function Loading() {
  return (
    <Container>
      <div className="flex flex-col gap-6 pt-5 sm:pt-8" aria-label="Loading">
        <Skeleton className="h-[210px] rounded-2xl" />
        <div className="grid grid-cols-4 gap-2.5">
          <Skeleton className="h-[76px]" />
          <Skeleton className="h-[76px]" />
          <Skeleton className="h-[76px]" />
          <Skeleton className="h-[76px]" />
        </div>
        <Skeleton className="h-[150px] rounded-2xl" />
        <Skeleton className="h-[120px] rounded-2xl" />
      </div>
    </Container>
  );
}
