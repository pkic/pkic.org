import { ProposalSpeakerHeadshotManager } from "../../../../../components/proposals/ProposalSpeakerHeadshotManager";

export function adminProposalSpeakerAssetPath(
  proposalId: string,
  userId: string,
  asset: "headshot" | "gravatar",
): string {
  return `/api/v1/admin/proposals/${encodeURIComponent(proposalId)}/speakers/${encodeURIComponent(userId)}/${asset}`;
}

export { ProposalSpeakerHeadshotManager };
