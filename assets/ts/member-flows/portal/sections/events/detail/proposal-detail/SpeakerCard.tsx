import {
  buildReplacementProposerOptions,
  ProposalSpeakerCard,
  type ProposalSpeaker,
} from "../../../../../../components/proposals/ProposalSpeakerCard";
import { toast } from "../../../../ui";
import { proposalSpeakerEndpoints } from "./proposal-api";

export { buildReplacementProposerOptions };

export { proposalSpeakerEndpoints };

export function SpeakerCard(props: Omit<Parameters<typeof ProposalSpeakerCard>[0], "endpoints">) {
  return <ProposalSpeakerCard {...props} notify={toast} endpoints={proposalSpeakerEndpoints()} />;
}

export type { ProposalSpeaker };
