import {
  buildReplacementProposerOptions,
  ProposalSpeakerCard,
  type ProposalSpeaker,
} from "../../../../../components/proposals/ProposalSpeakerCard";
import { toast } from "../../../../ui";

export { buildReplacementProposerOptions };

export function SpeakerCard(props: Omit<Parameters<typeof ProposalSpeakerCard>[0], "endpoints">) {
  return (
    <ProposalSpeakerCard
      {...props}
      notify={toast}
      endpoints={{
        speakerPath: (proposalId, userId, suffix = "") =>
          `/api/v1/admin/proposals/${encodeURIComponent(proposalId)}/speakers/${encodeURIComponent(userId)}${suffix ? `/${suffix}` : ""}`,
        assetPath: (proposalId, userId, asset) =>
          `/api/v1/admin/proposals/${encodeURIComponent(proposalId)}/speakers/${encodeURIComponent(userId)}/${asset}`,
      }}
    />
  );
}

export type { ProposalSpeaker };
