import type { ComponentType } from "preact";
import {
  IconArchive,
  IconBan,
  IconCheckOutline,
  IconClock,
  IconFlag,
  IconInfoOutline,
  IconLayersOutline,
  IconPencilOutline,
  IconRefreshOutline,
  IconRemoveOutline,
  IconSearchOutline,
  IconSend,
  IconUndoOutline,
} from "./icons/indicators";
import { Badge as ToneBadge, IconBadge } from "../ui/Badge";

import { statusLabel, statusTone } from "../../shared/status-display";
export { statusLabel, statusTone } from "../../shared/status-display";

const STATUS_ICON: Record<string, ComponentType> = {
  submitted: IconSend,
  resubmitted: IconRefreshOutline,
  under_review: IconSearchOutline,
  accepted: IconCheckOutline,
  accept: IconCheckOutline,
  approved: IconCheckOutline,
  registered: IconCheckOutline,
  rejected: IconRemoveOutline,
  reject: IconRemoveOutline,
  declined: IconRemoveOutline,
  "needs-work": IconPencilOutline,
  needs_work: IconPencilOutline,
  needs_revision: IconPencilOutline,
  withdrawn: IconUndoOutline,
  canceled: IconBan,
  cancelled: IconBan,
  spam: IconFlag,
  duplicate: IconLayersOutline,
  deleted: IconArchive,
  archived: IconArchive,
  pending: IconClock,
  pending_email_confirmation: IconClock,
  draft: IconPencilOutline,
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
    const Icon = STATUS_ICON[status] ?? IconInfoOutline;
    const accessibleLabel = label ?? `${statusLabel(status)}${count === undefined ? "" : ` ${count}`}`;
    return <IconBadge tone={statusTone(status)} label={accessibleLabel} icon={<Icon />} count={count} />;
  }
  return <ToneBadge tone={statusTone(status)}>{label ?? statusLabel(status)}</ToneBadge>;
}
