import { FlaskConical } from "lucide-react";

/** The standing "this is not real sign-in" label on auth screens. */
export function SandboxAuthNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/[0.07] px-4 py-3.5">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="text-xs leading-relaxed text-ink-muted">
        <p className="font-medium text-ink">Sandbox session — not real sign-in</p>
        <p className="mt-0.5">
          {children ??
            "You pick a fictional account stored on this device. There's no password and nothing is verified."}
        </p>
      </div>
    </div>
  );
}
