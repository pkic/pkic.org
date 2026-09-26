/**
 * The one place the interface names the proposal speaker roles.
 *
 * The values are the contract's, so a role added to `PROPOSAL_SPEAKER_ROLES`
 * appears in every role control at once; the label map is total on that
 * vocabulary, so the same addition is a compile error here until someone
 * decides what to call it. Controls that offer a subset filter this list
 * rather than writing their own.
 */
import { PROPOSAL_SPEAKER_ROLES, type ProposalSpeakerRole } from "../../shared/schemas/participant-roles";

const SPEAKER_ROLE_LABELS: Record<ProposalSpeakerRole, string> = {
  proposer: "Proposer",
  speaker: "Speaker",
  co_speaker: "Co-speaker",
  moderator: "Moderator",
  panelist: "Panelist",
};

export const SPEAKER_ROLE_OPTIONS: ReadonlyArray<{ value: ProposalSpeakerRole; label: string }> =
  PROPOSAL_SPEAKER_ROLES.map((role) => ({ value: role, label: SPEAKER_ROLE_LABELS[role] }));
