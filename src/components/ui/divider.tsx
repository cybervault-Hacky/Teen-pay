import { cn } from "@/lib/cn";

/** A hairline separator. Horizontal by default. */
export function Divider({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"hr">) {
  return (
    <hr
      aria-hidden
      className={cn("my-0 border-0 border-t border-line", className)}
      {...props}
    />
  );
}
