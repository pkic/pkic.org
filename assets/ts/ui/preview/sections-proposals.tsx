import { SpeakerParticipationPreview, ConfirmedSpeakerPreview } from "./SpeakerParticipationPreview";
import { ProposalProofSupportNotice } from "../../components/ProposalProofSupportNotice";
import type { PreviewSection } from "./PreviewShell";
import { ProposalIdentityPreview } from "./VerifiedOrganizationPreview";

/** Speaker submission states rendered with the production components and synthetic data. */
export const proposalSections: PreviewSection[] = [
  { id: "proposer-speaker", title: "Proposer speaker role", render: () => <ConfirmedSpeakerPreview proposer /> },
  { id: "speaker-confirmed", title: "Confirmed proposal participant", render: () => <ConfirmedSpeakerPreview /> },
  { id: "speaker-participation", title: "Speaker willingness", render: () => <SpeakerParticipationPreview /> },
  { id: "speaker-late-response", title: "Late speaker response", render: () => <SpeakerParticipationPreview late /> },
  {
    id: "proposal-identity",
    title: "Proposal identity",
    note: "The actual public proposal identity step embeds the shared verified-domain chooser.",
    render: () => <ProposalIdentityPreview />,
  },
  {
    id: "proposal-domain-review",
    title: "Proposal domain review",
    render: () => (
      <ProposalProofSupportNotice
        email="casey@research.example.test"
        reason="organization_domain_review"
        onUsePersonal={() => {}}
      />
    ),
  },
  {
    id: "proposal-address-review",
    title: "Proposal address review",
    render: () => (
      <ProposalProofSupportNotice
        email="casey@research.example.test"
        reason="address_review"
        onUsePersonal={() => {}}
      />
    ),
  },
];
