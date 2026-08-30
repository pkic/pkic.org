import {
  buildReplacementProposerOptions,
  ProposalSpeakerCard,
  type ProposalSpeaker,
} from "../../../../../../components/proposals/ProposalSpeakerCard";
import { toast } from "../../../../ui";
import { proposalSpeakerAssetPath, proposalSpeakerEndpoints } from "./proposal-api";

export { buildReplacementProposerOptions };

export { proposalSpeakerAssetPath, proposalSpeakerEndpoints };

export function SpeakerCard(props: Omit<Parameters<typeof ProposalSpeakerCard>[0], "endpoints">) {
  return <ProposalSpeakerCard {...props} notify={toast} endpoints={proposalSpeakerEndpoints()} />;
}

export type { ProposalSpeaker };
