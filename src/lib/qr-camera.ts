/**
 * The camera boundary for "Scan to pay" (Phase 9).
 *
 * Production-style scanning with browser APIs only:
 *   getUserMedia (rear camera, no audio) → <video> → BarcodeDetector
 *   ("qr_code") → the first decoded text → the caller.
 *
 * Privacy rules this module keeps:
 *   · the camera starts only on an explicit call (the scanner's
 *     "Start camera" button) and every track is stopped by `stop()`;
 *   · frames are read in memory by the browser's detector — never
 *     drawn to a canvas we keep, uploaded, stored or logged;
 *   · it knows nothing about payments: it hands back raw, untrusted
 *     text, which the caller validates (`parseQrPayload`) and resolves
 *     through the directory.
 *
 * Browsers without BarcodeDetector (or without a camera) report that
 * honestly; the scan screen then offers its sandbox paste fallback.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

export type CameraSupport = "supported" | "no_camera" | "no_detector";

function detectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

/** What this browser can do, without asking for any permission. */
export function cameraSupport(): CameraSupport {
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return "no_camera";
  }
  return detectorConstructor() ? "supported" : "no_detector";
}

export type CameraStartError = "denied" | "unavailable" | "unsupported";

/** Why the camera couldn't start. */
export class CameraError extends Error {
  constructor(readonly reason: CameraStartError) {
    super(`Camera ${reason}`);
    this.name = "CameraError";
  }
}

export interface CameraSession {
  /** Stops every camera track and the detection loop. Idempotent. */
  stop: () => void;
}

/**
 * Starts the camera into `video` and calls `onDetect` once with the
 * first QR text seen (then stops by itself). Rejects with a
 * `CameraError` when permission is refused or no camera exists.
 */
export async function startCameraScan(
  video: HTMLVideoElement,
  onDetect: (text: string) => void,
  intervalMs = 250,
): Promise<CameraSession> {
  const Detector = detectorConstructor();
  if (!Detector || cameraSupport() !== "supported") throw new CameraError("unsupported");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    throw new CameraError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
  }

  const detector = new Detector({ formats: ["qr_code"] });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  try {
    await video.play();
  } catch {
    // Autoplay can be refused; detection still works once frames arrive.
  }

  const tick = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      const text = codes.find((c) => typeof c.rawValue === "string" && c.rawValue.length > 0)?.rawValue;
      if (text !== undefined && !stopped) {
        stop();
        onDetect(text);
        return;
      }
    } catch {
      // A frame that can't be read yet (camera warming up) — try again.
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);

  return { stop };
}
