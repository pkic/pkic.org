import { Badge as ToneBadge } from "../ui/Badge";

import { statusLabel, statusTone } from "../../shared/status-display";
export { statusLabel, statusTone } from "../../shared/status-display";

interface BadgeProps {
  status: string;
  label?: string;
}

/**
 * A status as a pill. The vocabulary is ours; the pill is the system's, so it
 * carries the tone dot that keeps status from resting on color alone.
 *
 * Always words. An icon-only variant drew the same check for "accepted" in a
 * Status column and "accept" in a Recommendations column beside it, so a
 * glyph could not be read without its neighbours.
 */
export function Badge({ status, label }: BadgeProps) {
  return <ToneBadge tone={statusTone(status)}>{label ?? statusLabel(status)}</ToneBadge>;
}
