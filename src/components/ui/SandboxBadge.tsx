import { Badge } from "./Badge";

/**
 * The single honest marker for simulated money. Render wherever figures
 * or flows could be mistaken for real financial activity.
 */
export function SandboxBadge() {
  return <Badge tone="info">Sandbox</Badge>;
}
