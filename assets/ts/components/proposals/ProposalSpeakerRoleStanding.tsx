import type { ProposalSpeakerRole } from "../../../shared/schemas/participant-roles";
import { SPEAKER_ROLE_LABELS } from "../../../shared/speaker-roles";
import "../../ui/SpeakerPortraitCard.css";

/** Role and proposal ownership stay distinct in both speaker rosters. Render inside a dl. */
export function ProposalSpeakerRoleStanding({
  role,
  isCurrentProposer,
}: {
  role: ProposalSpeakerRole;
  isCurrentProposer: boolean;
}) {
  return (
    <>
      <dt class="pk-sr-only">Role</dt>
      <dd>{SPEAKER_ROLE_LABELS[role]}</dd>
      {isCurrentProposer && role !== "proposer" && (
        <>
          <dt class="pk-sr-only">Ownership</dt>
          <dd>{SPEAKER_ROLE_LABELS.proposer}</dd>
        </>
      )}
    </>
  );
}
