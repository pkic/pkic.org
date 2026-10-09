import type { ComponentType } from "preact";
import { IconArchive, IconBan, IconClock, IconFlag, IconSend } from "./icons/indicators";
import {
  IconCheckmark,
  IconInfoCircle,
  IconLayers,
  IconPencil,
  IconRefresh,
  IconRemove,
  IconSearch,
  IconUndo,
} from "./icons";
import { Badge as ToneBadge, IconBadge } from "../ui/Badge";

import { statusLabel, statusTone } from "../../shared/status-display";
export { statusLabel, statusTone } from "../../shared/status-display";

const STATUS_ICON: Record<string, ComponentType> = {
  submitted: IconSend,
  resubmitted: IconRefresh,
  under_review: IconSearch,
  accepted: IconCheckmark,
  accept: IconCheckmark,
  approved: IconCheckmark,
  registered: IconCheckmark,
  rejected: IconRemove,
  reject: IconRemove,
  declined: IconRemove,
  "needs-work": IconPencil,
  needs_work: IconPencil,
  needs_revision: IconPencil,
  withdrawn: IconUndo,
  canceled: IconBan,
  cancelled: IconBan,
  spam: IconFlag,
  duplicate: IconLayers,
  deleted: IconArchive,
  archived: IconArchive,
  pending: IconClock,
  pending_email_confirmation: IconClock,
  draft: IconPencil,
};

interface BadgeProps {
  status: string;
  label?: string;
  iconOnly?: boolean;
  count?: number;
}

/**
 * A status as a pill. The vocabulary is ours; the pill is the system's, so it
 * carries the tone dot that keeps status from resting on colour alone.
 */
export function Badge({ status, label, iconOnly = false, count }: BadgeProps) {
  if (iconOnly) {
    const Icon = STATUS_ICON[status] ?? IconInfoCircle;
    const accessibleLabel = label ?? `${statusLabel(status)}${count === undefined ? "" : ` ${count}`}`;
    return <IconBadge tone={statusTone(status)} label={accessibleLabel} icon={<Icon />} count={count} />;
  }
  return <ToneBadge tone={statusTone(status)}>{label ?? statusLabel(status)}</ToneBadge>;
}
