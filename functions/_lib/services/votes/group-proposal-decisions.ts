import type { GroupVoteProposal } from "../../../../assets/shared/schemas/group-vote-proposals";
import type { AuthAdmin, DatabaseLike } from "../../types";
import type { GroupResourceViewer } from "../resource-grants";
import { getGroupVoteProposalDetail } from "./group-proposal-read-model";
import { approveVoteProposal, rejectVoteProposal } from "./proposals";
import type { VoteSummary } from "./shared";

export async function approveGroupVoteProposal(
  db: DatabaseLike,
  actor: AuthAdmin,
  viewer: GroupResourceViewer,
  groupId: string,
  proposalId: string,
): Promise<{ proposal: GroupVoteProposal; convertedVote: VoteSummary }> {
  const result = await approveVoteProposal(db, actor, proposalId, groupId);
  return {
    proposal: (await getGroupVoteProposalDetail(db, viewer, groupId, proposalId)).proposal,
    convertedVote: result.convertedVote,
  };
}

export async function rejectGroupVoteProposal(
  db: DatabaseLike,
  actor: AuthAdmin,
  viewer: GroupResourceViewer,
  groupId: string,
  proposalId: string,
  reason: string,
): Promise<{ proposal: GroupVoteProposal; outboxId: string | null }> {
  const result = await rejectVoteProposal(db, actor, proposalId, reason, groupId);
  return {
    proposal: (await getGroupVoteProposalDetail(db, viewer, groupId, proposalId)).proposal,
    outboxId: result.outboxId,
  };
}
