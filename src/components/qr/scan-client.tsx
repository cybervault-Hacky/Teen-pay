"use client";

import { ArrowDownLeft, Check, ClipboardPaste, QrCode, Send, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { PeerProfile } from "@/domain";
import { QR_PAYLOAD_MAX_LENGTH } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CameraScanner } from "./camera-scanner";

/**
 * "Scan to pay" — QR in, recipient out. Never money.
 *
 *   camera (real BarcodeDetector) ─┐
 *                                  ├─▶ resolveQrIdentity (untrusted text →
 *   sandbox paste (clearly marked) ┘     strict parse → directory) ─▶ result
 *
 *   result: [Pay] / [Request] → startQrPayment / startQrRequest re-resolve
 *   and open the existing Send / Request flow with the person
 *   preselected; the amount, review and confirm happen there.
 *
 * The paste box exists because a sandbox (and automated tests) may
 * have no camera; it's labelled as such and nothing claims a camera
 * scan happened when it didn't.
 */
export function ScanClient() {
  const { actions, contacts } = useSandbox();
  const router = useRouter();
  const [payload, setPayload] = useState<string | null>(null);
  const [profile, setProfile] = useState<PeerProfile | null>(null);
  const [source, setSource] = useState<"camera" | "paste" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pasted, setPasted] = useState("");
  const inputId = useId();
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (profile) resultHeading.current?.focus();
  }, [profile]);

  const resolve = (text: string, from: "camera" | "paste") => {
    setStatus("");
    const result = actions.resolveQrIdentity(text);
    if (!result.ok) {
      setError(result.error.message);
      setProfile(null);
      setPayload(null);
      return;
    }
    setError(null);
    setSource(from);
    setPayload(text);
    setProfile(result.value);
  };

  const go = (kind: "pay" | "request") => {
    if (!payload) return;
    // Re-resolved now, against current state — not what was scanned earlier.
    const result = kind === "pay" ? actions.startQrPayment(payload) : actions.startQrRequest(payload);
    if (!result.ok) {
      setError(result.error.message);
      setProfile(null);
      return;
    }
    router.push(result.value.href);
  };

  const save = () => {
    if (!profile) return;
    const result = actions.addContact(profile.handle);
    setStatus(result.ok ? `${profile.handle} added to favourites.` : result.error.message);
  };

  const scanAgain = () => {
    setProfile(null);
    setPayload(null);
    setSource(null);
    setError(null);
    setStatus("");
    setPasted("");
  };

  const saved = profile ? contacts.isFavourite(profile.handle) : false;

  return (
    <>
      <PageHeader
        title="Scan to pay"
        description="Scan another teen's TeenPay QR to pay or request. You'll always confirm first."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />

      {profile ? (
        <div className="mx-auto max-w-sm">
          <h2
            ref={resultHeading}
            tabIndex={-1}
            className="mb-4 text-[22px] font-semibold tracking-tight text-ink outline-none"
          >
            Pay or request
          </h2>
          <Card className="p-5">
            <div className="flex items-center gap-3.5">
              <Avatar name={profile.name} initials={profile.initials} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-ink">{profile.name}</p>
                <p className="truncate text-sm text-ink-muted">{profile.handle}</p>
              </div>
            </div>
            <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-3.5 text-xs text-ink-faint">
              <QrCode className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {source === "camera" ? "Scanned with your camera" : "From a pasted sandbox QR"} · nothing has moved
            </p>
          </Card>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button onClick={() => go("pay")}>
              <Send className="h-4 w-4" aria-hidden />
              Pay
            </Button>
            <Button variant="secondary" onClick={() => go("request")}>
              <ArrowDownLeft className="h-4 w-4" aria-hidden />
              Request
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <Button variant="ghost" size="sm" onClick={save} disabled={saved}>
              {saved ? <Check className="h-4 w-4" aria-hidden /> : <Star className="h-4 w-4" aria-hidden />}
              {saved ? "In favourites" : "Add to favourites"}
            </Button>
            <Button variant="ghost" size="sm" onClick={scanAgain}>
              <QrCode className="h-4 w-4" aria-hidden />
              Scan another
            </Button>
          </div>
          <p role="status" aria-live="polite" className={status ? "mt-3 px-1 text-sm text-ink-muted" : "sr-only"}>
            {status}
          </p>
          {error && (
            <p role="alert" className="mt-3 px-1 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="mx-auto max-w-sm space-y-6">
          <section aria-label="Camera">
            <CameraScanner onDetect={(text) => resolve(text, "camera")} />
          </section>

          {error && (
            <p role="alert" className="px-1 text-sm text-danger">
              {error}
            </p>
          )}

          <section aria-label="Sandbox QR">
            <Card className="p-5">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  resolve(pasted, "paste");
                }}
              >
                <label htmlFor={inputId} className="block text-sm font-medium text-ink">
                  Use a sandbox QR
                </label>
                <p id={`${inputId}-hint`} className="mt-1 text-xs text-ink-faint">
                  No camera? Paste the text of a TeenPay QR code, like teenpay://user/@meera?v=1.
                  For testing in this sandbox.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    id={inputId}
                    aria-describedby={`${inputId}-hint`}
                    value={pasted}
                    onChange={(event) => setPasted(event.target.value.slice(0, QR_PAYLOAD_MAX_LENGTH + 16))}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="teenpay://user/@…"
                    className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface-2 px-3.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
                  />
                  <Button type="submit" variant="secondary" disabled={pasted.trim() === ""}>
                    <ClipboardPaste className="h-4 w-4" aria-hidden />
                    Look up
                  </Button>
                </div>
              </form>
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
