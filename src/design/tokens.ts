/**
 * Design tokens mirrored in TypeScript for contexts CSS can't reach
 * (canvas, SVG fills, motion values, meta theme-color).
 *
 * The source of truth for color *values* is `globals.css` (`--tp-*`
 * custom properties). Keep the two in sync when the palette evolves.
 */

export const canvas = {
  dark: "#07090d",
  light: "#f3f4f7",
} as const;

export const accent = {
  dark: "#45d6a2",
  light: "#087a52",
} as const;

export type ThemeName = "dark" | "light";
export const DEFAULT_THEME: ThemeName = "dark";
export const THEME_STORAGE_KEY = "teenpay-theme";

/** Content widths — mobile-first, intentionally constrained on desktop. */
export const layout = {
  /** Narrow reading/transaction column. */
  contentNarrow: 560,
  /** Default app column. */
  content: 720,
  /** Wide screens (desktop dashboard grids). */
  contentWide: 1080,
  /** Desktop sidebar width. */
  sidebar: 248,
} as const;

/** Layering scale. */
export const zIndex = {
  header: 30,
  bottomNav: 40,
  sidebar: 40,
  scrim: 50,
  sheet: 60,
  toast: 70,
} as const;

/** Shared radii (mirrors Tailwind scale usage across the kit). */
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;
