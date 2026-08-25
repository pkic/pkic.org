import type { GroupVoteProposal } from "../../../../assets/shared/schemas/group-vote-proposals";
import type { AuthMember, DatabaseLike } from "../../types";
import type { GroupResourceViewer } from "../resource-grants";
import { getGroupVoteProposalDetail } from "./group-proposal-read-model";
import {
  endorseVoteProposal,
  submitVoteProposal,
  withdrawEndorsement,
  withdrawVoteProposal,
  type SubmitProposalInput,
} from "./proposals";
import type { VoteSummary } from "./shared";

type SelectedGroupProposalInput = Omit<SubmitProposalInput, "ownerGroupId">;

export async function submitGroupVoteProposal(
  db: DatabaseLike,
  member: AuthMember,
  viewer: GroupResourceViewer,
  groupId: string,
  input: SelectedGroupProposalInput,
): Promise<GroupVoteProposal> {
  const submitted = await submitVoteProposal(db, member, { ...input, ownerGroupId: groupId });
  return (await getGroupVoteProposalDetail(db, viewer, groupId, submitted.id)).proposal;
}

export async function endorseGroupVoteProposal(
  db: DatabaseLike,
  member: AuthMember,
  viewer: GroupResourceViewer,
  groupId: string,
  proposalId: string,
): Promise<{ proposal: GroupVoteProposal; convertedVote: VoteSummary | null }> {
  const result = await endorseVoteProposal(db, member, proposalId, groupId);
  return {
    proposal: (await getGroupVoteProposalDetail(db, viewer, groupId, proposalId)).proposal,
    convertedVote: result.convertedVote,
  };
}

export function withdrawGroupVoteProposalEndorsement(
  db: DatabaseLike,
  member: AuthMember,
  groupId: string,
  proposalId: string,
): Promise<void> {
  return withdrawEndorsement(db, member, proposalId, groupId);
}

export function withdrawGroupVoteProposal(
  db: DatabaseLike,
  member: AuthMember,
  groupId: string,
  proposalId: string,
): Promise<void> {
  return withdrawVoteProposal(db, member, proposalId, groupId);
}
