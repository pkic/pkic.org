import { ProposalSpeakerHeadshotManager } from "../../../../../../components/proposals/ProposalSpeakerHeadshotManager";
import { proposalResourcePath } from "./proposal-api";

export function proposalSpeakerAssetPath(proposalId: string, userId: string, _asset: "headshot" | "gravatar"): string {
  return proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}/headshot`);
}

export { ProposalSpeakerHeadshotManager };
