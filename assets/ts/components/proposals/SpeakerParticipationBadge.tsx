/**
 * Where one speaker stands on a proposal, as one badge.
 *
 * An invitation nobody has answered is a speaker the agenda cannot publish, so
 * it wears the warning tone rather than the informational one an invitation
 * otherwise carries. A confirmed or declined answer carries its date inside
 * the badge, so the card does not say "Confirmed" a second time beside it.
 */
import { SPEAKER_NOT_YET_ACCEPTED_LABEL } from "../../../shared/proposal-speaker-acceptance";
import { formatDate } from "../../shared/ui";
import { Badge as ToneBadge } from "../../ui/Badge";
import { Badge, statusLabel } from "../Badge";

export function SpeakerParticipationBadge({ status, answeredAt }: { status: string; answeredAt?: string | null }) {
  if (status === "invited") return <ToneBadge tone="warn">{SPEAKER_NOT_YET_ACCEPTED_LABEL}</ToneBadge>;
  return <Badge status={status} label={answeredAt ? `${statusLabel(status)} ${formatDate(answeredAt)}` : undefined} />;
}
