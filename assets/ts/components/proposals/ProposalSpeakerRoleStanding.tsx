import type { ComponentChildren } from "preact";
import type { ProposalSpeakerRole } from "../../../shared/schemas/participant-roles";
import { SPEAKER_ROLE_LABELS } from "../../../shared/speaker-roles";
import { Badge } from "../../ui/Badge";
import "./ProposalSpeakerRoleStanding.css";

/** Role and proposal ownership stay distinct in both speaker rosters. */
export function ProposalSpeakerRoleStanding({
  name,
  role,
  isCurrentProposer,
  badges = false,
  children,
}: {
  name: string;
  role: ProposalSpeakerRole;
  isCurrentProposer: boolean;
  /** Compact badges beside the proposer's roster email and status. */
  badges?: boolean;
  children?: ComponentChildren;
}) {
  const label = (text: string) =>
    badges ? (
      <Badge tone="neutral" dot={false}>
        {text}
      </Badge>
    ) : (
      text
    );
  return (
    <dl class="pk-proposal-speaker-standing" data-badges={badges || undefined} aria-label={`Where ${name} stands`}>
      <dt class="pk-sr-only">Role</dt>
      <dd>{label(SPEAKER_ROLE_LABELS[role])}</dd>
      {isCurrentProposer && role !== "proposer" && (
        <>
          <dt class="pk-sr-only">Ownership</dt>
          <dd>{label(SPEAKER_ROLE_LABELS.proposer)}</dd>
        </>
      )}
      {children}
    </dl>
  );
}
