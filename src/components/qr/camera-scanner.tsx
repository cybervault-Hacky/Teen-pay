"use client";

import { Camera, CameraOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CameraError, cameraSupport, startCameraScan, type CameraSession, type CameraSupport } from "@/lib/qr-camera";
import { Button } from "@/components/ui/button";

type CameraState = "idle" | "starting" | "scanning" | "denied" | "unavailable";

const MESSAGES: Partial<Record<CameraState | CameraSupport, string>> = {
  no_camera: "This browser can't use a camera here.",
  no_detector: "Camera scanning isn't available in this browser.",
  denied: "Camera permission was not given. You can allow it in your browser settings and try again.",
  unavailable: "No camera could be started on this device.",
};

/**
 * The camera half of "Scan to pay". Asks for camera permission only
 * when the person taps "Start camera" on this screen, stops the camera
 * the moment a code is read, when they tap Stop, when the app goes to
 * the background, and when they leave. Frames never leave the browser.
 * Hands raw text to `onDetect` — validation happens upstream.
 */
export function CameraScanner({ onDetect }: { onDetect: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  // Bumped by every stop / unmount: a start that resolves after it is stale.
  const generationRef = useRef(0);
  const [support, setSupport] = useState<CameraSupport | null>(null);
  const [state, setState] = useState<CameraState>("idle");

  const stop = useCallback(() => {
    generationRef.current += 1;
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  useEffect(() => {
    setSupport(cameraSupport());
    const onHidden = () => {
      if (document.visibilityState === "hidden" && sessionRef.current) {
        stop();
        setState("idle");
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      stop();
    };
  }, [stop]);

  const start = async () => {
    const video = videoRef.current;
    if (!video) return;
    setState("starting");
    const generation = generationRef.current;
    try {
      const session = await startCameraScan(video, (text) => {
        sessionRef.current = null;
        setState("idle");
        onDetect(text);
      });
      // Stopped, or left the screen, while the permission prompt was open.
      if (generation !== generationRef.current) {
        session.stop();
        return;
      }
      sessionRef.current = session;
      setState("scanning");
    } catch (error) {
      if (generation !== generationRef.current) return;
      setState(error instanceof CameraError && error.reason === "denied" ? "denied" : "unavailable");
    }
  };

  const unsupported = support !== null && support !== "supported";
  const message = unsupported ? MESSAGES[support] : MESSAGES[state];
  const live = state === "scanning" || state === "starting";

  return (
    <div>
      <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl border border-line bg-surface-2">
        <video
          ref={videoRef}
          aria-label="Camera preview"
          className={live ? "h-full w-full object-cover" : "hidden"}
          muted
          playsInline
        />
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {unsupported || state === "denied" || state === "unavailable" ? (
              <CameraOff className="h-7 w-7 text-ink-faint" aria-hidden />
            ) : (
              <Camera className="h-7 w-7 text-ink-faint" aria-hidden />
            )}
            <p className="text-sm text-ink-muted">
              {unsupported ? "Camera unavailable" : "Point your camera at a TeenPay QR code"}
            </p>
          </div>
        )}
        {live && (
          // The viewfinder frame — decorative.
          <div aria-hidden className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/80" />
        )}
      </div>

      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-center text-sm text-ink-muted">
        {state === "starting"
          ? "Starting camera…"
          : state === "scanning"
            ? "Camera on — looking for a TeenPay QR code."
            : (message ?? "")}
      </p>

      {!unsupported && (
        <div className="mt-3 flex justify-center">
          {live ? (
            <Button
              variant="secondary"
              onClick={() => {
                stop();
                setState("idle");
              }}
            >
              <CameraOff className="h-4 w-4" aria-hidden />
              Stop camera
            </Button>
          ) : (
            <Button variant="secondary" onClick={start} disabled={support === null}>
              {support === null ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Camera className="h-4 w-4" aria-hidden />
              )}
              {state === "denied" || state === "unavailable" ? "Try camera again" : "Start camera"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
