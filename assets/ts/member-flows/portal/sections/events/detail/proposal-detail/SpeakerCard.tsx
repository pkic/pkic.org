import {
  buildReplacementProposerOptions,
  ProposalSpeakerCard,
  type ProposalSpeaker,
} from "../../../../../../components/proposals/ProposalSpeakerCard";
import { toast } from "../../../../ui";
import { proposalResourcePath } from "./proposal-api";

export { buildReplacementProposerOptions };

export function SpeakerCard(props: Omit<Parameters<typeof ProposalSpeakerCard>[0], "endpoints">) {
  return (
    <ProposalSpeakerCard
      {...props}
      notify={toast}
      endpoints={{
        speakerPath: (proposalId, userId, suffix = "") =>
          proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}${suffix ? `/${suffix}` : ""}`),
        assetPath: (proposalId, userId, _asset) =>
          proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}/headshot`),
        reminderPath: (proposalId, userId) =>
          proposalResourcePath(proposalId, `speakers/${encodeURIComponent(userId)}/reminders`),
        reminderBody: (kind) => ({ kind }),
        gravatarBody: { source: "gravatar" },
      }}
    />
  );
}

export type { ProposalSpeaker };
