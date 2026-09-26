/**
 * Sandbox identifiers — short, readable, unique-enough for local state.
 * Not security tokens: unpredictability is not required, readability is
 * (IDs surface in transaction detail sheets).
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomSuffix(length: number): string {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** e.g. `le_k3x8m2pq9`, `req_7h2bd91s`, `op_qw3e87zx`. */
export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomSuffix(6)}`;
}

/** Idempotency key for a fresh user operation. */
export function newOperationKey(): string {
  return uid("op");
}
