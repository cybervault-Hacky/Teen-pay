import { clsx, type ClassValue } from "clsx";

/** Merge conditional class names. The only class helper in the app. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
