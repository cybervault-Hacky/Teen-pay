/**
 * Local id generation for sandbox records.
 * Ids double as idempotency keys, so they must be unique per
 * action and stable once created.
 */
export function makeId(prefix: string): string {
  let random: string;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    random = crypto.randomUUID();
  } else {
    random = Math.random().toString(36).slice(2, 10);
  }
  return `${prefix}_${random}`;
}

/**
 * A fictional sandbox invite code, e.g. "TEEN-4821". Not a secret
 * and not a credential — it only pairs two sandbox identities on
 * this device.
 */
export function makeInviteCode(): string {
  let n: number;
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  } else {
    n = Math.floor(Math.random() * 1_000_000);
  }
  return `TEEN-${1000 + (n % 9000)}`;
}
