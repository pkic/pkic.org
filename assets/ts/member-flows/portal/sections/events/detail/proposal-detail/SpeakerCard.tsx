import {
  buildReplacementProposerOptions,
  ProposalSpeakerCard,
  type ProposalSpeakerEndpointConfig,
  type ProposalSpeaker,
} from "../../../../../../components/proposals/ProposalSpeakerCard";
import { toast } from "../../../../ui";
import { proposalResourcePath } from "./proposal-api";

export { buildReplacementProposerOptions };

export function proposalSpeakerAssetPath(proposalId: string, userId: string, _asset: "headshot" | "gravatar"): string {
  return proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}/headshot`);
}

export function proposalSpeakerEndpoints(): ProposalSpeakerEndpointConfig {
  return {
    speakerPath: (proposalId, userId, suffix = "") =>
      proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}${suffix ? `/${suffix}` : ""}`),
    assetPath: proposalSpeakerAssetPath,
    reminderPath: (proposalId, userId) =>
      proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}/reminders`),
    reminderBody: (kind) => ({ kind }),
    gravatarBody: { source: "gravatar" },
  };
}

export function SpeakerCard(props: Omit<Parameters<typeof ProposalSpeakerCard>[0], "endpoints">) {
  return <ProposalSpeakerCard {...props} notify={toast} endpoints={proposalSpeakerEndpoints()} />;
}

export type { ProposalSpeaker };
