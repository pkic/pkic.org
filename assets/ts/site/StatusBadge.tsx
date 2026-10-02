import { Badge as ToneBadge } from "../ui/Badge";
import { statusLabel, statusTone } from "../../shared/status-display";

interface BadgeProps {
  status: string;
  label?: string;
}

/**
 * A status as a pill. The vocabulary is ours; the pill is the system's, so it
 * carries the tone dot that keeps status from resting on colour alone.
 */
export function StatusBadge({ status, label }: BadgeProps) {
  return <ToneBadge tone={statusTone(status)}>{label ?? statusLabel(status)}</ToneBadge>;
}
