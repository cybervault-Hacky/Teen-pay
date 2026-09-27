/**
 * Domain: payment recipients.
 *
 * Money can move to people (friends, family) or to trusted
 * merchants. Verification of recipients is a later concern; this
 * boundary only separates the two kinds.
 */
export type RecipientType = "person" | "merchant";

export interface Recipient {
  id: string;
  name: string;
  type: RecipientType;
  /**
   * Sandbox payment identifier, e.g. "@riya".
   * Will be replaced by a real handle/account later.
   */
  handle: string;
  /** Optional short descriptor, e.g. "Close friend". */
  descriptor?: string;
}
