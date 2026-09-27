import { create } from "qrcode";

/**
 * QR module matrix for a payload, via the maintained `qrcode` encoder
 * (ISO/IEC 18004: Reed–Solomon error correction, masking, version
 * selection). Deterministic: the same text always yields the same
 * matrix. `true` = dark module. The quiet zone is left to the renderer.
 */
export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

/** Level M (~15% recovery): robust on screens, small enough to scan fast. */
export function qrMatrix(payload: string): QrMatrix {
  const code = create(payload, { errorCorrectionLevel: "M" });
  const size = code.modules.size;
  const modules: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col += 1) line.push(code.modules.get(row, col) === 1);
    modules.push(line);
  }
  return { size, modules };
}

/** One SVG path (`M x y h1 v1 h-1 z` per dark module), offset by `margin`. */
export function qrPath(matrix: QrMatrix, margin: number): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.modules[row]![col]) parts.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return parts.join("");
}
