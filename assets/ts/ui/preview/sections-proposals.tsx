import { ProposalProofSupportNotice } from "../../components/ProposalProofSupportNotice";
import type { PreviewSection } from "./PreviewShell";
import { ProposalIdentityPreview } from "./VerifiedOrganizationPreview";
import { ProposalRevisionPreview } from "./ProposalRevisionPreview";

/** Speaker submission states rendered with the production components and synthetic data. */
export const proposalSections: PreviewSection[] = [
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
  { id: "proposal-revision", title: "Proposal revision", render: () => <ProposalRevisionPreview /> },
];
