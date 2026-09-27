"use client";

import { Check, Shield, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/auth/provider";
import {
  DISPLAY_NAME_MAX,
  USERNAME_MAX,
  USERNAME_MIN,
  checkDisplayName,
  type UserRole,
} from "@/domain";
import { cn } from "@/lib/cn";
import { homeHrefFor } from "@/lib/navigation";
import { useSandboxData } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SandboxAuthNotice } from "./sandbox-auth-notice";

const ROLE_OPTIONS: { role: UserRole; title: string; description: string; icon: typeof Sparkles }[] = [
  {
    role: "teen",
    title: "Teen",
    description: "Your own money space, pay friends, save for goals.",
    icon: Sparkles,
  },
  {
    role: "parent",
    title: "Parent / Guardian",
    description: "Connect with your teen, set rules and approve payments.",
    icon: Shield,
  },
];

/**
 * Create a sandbox account: a role, a name and a TeenPay ID — nothing
 * else. No phone, date of birth, ID documents or bank details.
 */
export function CreateAccountScreen() {
  const auth = useAuth();
  const data = useSandboxData();
  const router = useRouter();
  const roleLegendId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const [role, setRole] = useState<UserRole>("teen");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [touched, setTouched] = useState({ name: false, username: false });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Already signed in → into the app.
  const session = auth.status === "authenticated" ? auth.session : null;
  useEffect(() => {
    if (session) router.replace(homeHrefFor(session.role));
  }, [session, router]);

  const nameCheck = checkDisplayName(name);
  const usernameCheck = data.checkUsername(username);
  const showNameError = (touched.name || submitted) && nameCheck.message;
  const showUsernameError = (touched.username || submitted || username.length > 0) && usernameCheck.message;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (nameCheck.message) {
      nameRef.current?.focus();
      return;
    }
    if (usernameCheck.message) {
      usernameRef.current?.focus();
      return;
    }
    setBusy(true);
    const created = data.createAccount({ role, displayName: name, username });
    if (!created.ok) {
      setBusy(false);
      setFormError(created.error.message);
      if (created.error.code === "username_taken") usernameRef.current?.focus();
      return;
    }
    const { account } = created.value;
    const signedIn = await auth.signIn({ method: "sandbox", accountId: account.id, role: account.role });
    setBusy(false);
    if (!signedIn.ok) setFormError(signedIn.message);
    // On success the effect above takes over navigation.
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create a sandbox account</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Just a name and a TeenPay ID. It lives on this device only.
      </p>

      <form noValidate onSubmit={(e) => void submit(e)} className="mt-6 space-y-5">
        <fieldset>
          <legend id={roleLegendId} className="mb-2 text-sm font-medium text-ink">
            I&apos;m a…
          </legend>
          <div role="radiogroup" aria-labelledby={roleLegendId} className="grid gap-2.5 sm:grid-cols-2">
            {ROLE_OPTIONS.map((option) => {
              const selected = role === option.role;
              const Icon = option.icon;
              return (
                <button
                  key={option.role}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.title}
                  aria-describedby={`${roleLegendId}-${option.role}`}
                  onClick={() => setRole(option.role)}
                  className={cn(
                    "relative flex min-w-0 flex-col items-start rounded-2xl border px-4 py-3.5 text-left",
                    "transition-[background-color,border-color] duration-150",
                    selected
                      ? "border-accent/50 bg-accent/10"
                      : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <Icon className={cn("h-4 w-4", selected ? "text-accent" : "text-ink-muted")} aria-hidden />
                    {selected && (
                      <span aria-hidden className="flex items-center gap-1 text-xs font-medium text-accent">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Selected
                      </span>
                    )}
                  </span>
                  <span className="mt-2 text-sm font-semibold text-ink">{option.title}</span>
                  <span
                    id={`${roleLegendId}-${option.role}`}
                    className="mt-0.5 text-xs leading-relaxed text-ink-muted"
                  >
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <Input
          ref={nameRef}
          label="Your name"
          name="displayName"
          autoComplete="off"
          maxLength={DISPLAY_NAME_MAX + 10}
          placeholder={role === "teen" ? "e.g. Kabir Mehta" : "e.g. Neha Mehta"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          hint="Shown to your family in the sandbox."
          error={showNameError ? (nameCheck.message ?? undefined) : undefined}
        />

        <Input
          ref={usernameRef}
          label="TeenPay ID"
          name="username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="e.g. kabir"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, username: true }))}
          hint={
            usernameCheck.problem === null
              ? `Available — you'll be @${usernameCheck.username}`
              : `${USERNAME_MIN}–${USERNAME_MAX} characters: letters, numbers, dots or underscores.`
          }
          error={showUsernameError ? (usernameCheck.message ?? undefined) : undefined}
        />

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth disabled={busy || !data.ready}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-ink-muted">
        Already have one?{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>

      <div className="mt-8">
        <SandboxAuthNotice>
          No phone number, date of birth, ID documents or bank details are asked
          for — and none would be accepted. There&apos;s no password, and
          nothing is verified.
        </SandboxAuthNotice>
      </div>
    </div>
  );
}
