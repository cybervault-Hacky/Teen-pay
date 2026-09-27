"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { qrMatrix, qrPath } from "@/lib/qr-matrix";

const QUIET_ZONE = 4;

/**
 * A real, scannable QR code for `payload`, drawn as one crisp SVG
 * path. Always dark modules on a white tile with the standard 4-module
 * quiet zone — scanners need that contrast, so it doesn't follow the
 * theme. `label` is the accessible description (the image itself
 * carries no other text).
 */
export function QrCode({
  payload,
  label,
  className,
}: {
  payload: string;
  label: string;
  className?: string;
}) {
  const { size, path } = useMemo(() => {
    const matrix = qrMatrix(payload);
    return { size: matrix.size + QUIET_ZONE * 2, path: qrPath(matrix, QUIET_ZONE) };
  }, [payload]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      data-qr-payload={payload}
      className={cn("block h-auto w-full rounded-2xl bg-white", className)}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#0b0b0f" />
    </svg>
  );
}
