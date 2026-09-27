import { AppLogo } from "@/components/layout/app-logo";

/** Quiet full-height status while a session is restored or redirected. */
export function AuthStatusScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <AppLogo />
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {message}
      </p>
    </div>
  );
}
