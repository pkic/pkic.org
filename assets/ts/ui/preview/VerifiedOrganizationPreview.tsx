/** The production chooser and proposal embedding with synthetic verified-mailbox fixtures. */
import { useRef, useState } from "preact/hooks";
import {
  VerifiedOrganizationDetails,
  type VerifiedOrganizationController,
} from "../../components/identities/VerifiedOrganizationDetails";
import { VerifiedOrganizationNameField } from "../../components/identities/VerifiedOrganizationNameField";
import { EventProposalIdentityStep } from "../../components/EventProposalIdentityStep";
import { identityAffiliationPreviewResponseSchema } from "../../../shared/schemas/identity-affiliation";

const initial = identityAffiliationPreviewResponseSchema.parse({
  email: "casey@research.example.test",
  domain: "example.test",
  domains: [
    { domain: "example.test", canLink: false, organizationName: "Example Research" },
    { domain: "research.example.test", canLink: true, organizationName: null },
  ],
  organization: { id: "00000000-0000-4000-8000-000000000011", name: "Example Research" },
  organizations: [
    { id: "00000000-0000-4000-8000-000000000011", name: "Example Research", identityId: null, jobTitle: null },
  ],
});
export function VerifiedOrganizationPreview() {
  const controller = useRef<VerifiedOrganizationController>({});
  return (
    <VerifiedOrganizationDetails
      initial={{
        ...initial,
        organization: null,
        organizations: [
          ...initial.organizations,
          { id: "00000000-0000-4000-8000-000000000012", name: "Example Labs", identityId: null, jobTitle: null },
        ],
      }}
      emailId={null}
      controller={controller.current}
      resolve={async (domain) => ({ ...initial, domain: domain ?? initial.domain })}
      prepare={async () => ({ ...initial, contextToken: "synthetic-context-01234567890123456789" })}
    />
  );
}
export function ProposalIdentityPreview() {
  return (
    <EventProposalIdentityStep
      enabled
      eventSlug="example-conference"
      // A confirmed address belongs to a speaker's link; a proposer signs in instead.
      speakerManagementToken="synthetic-speaker-link-0123456789012345678901"
      consents={() => []}
      onChange={() => {}}
      initialProof={{
        token: "synthetic-verification-01234567890123456789",
        result: {
          status: "ready",
          continuationToken: "synthetic-continuation-01234567890123456789",
          applicantKind: "organization",
          consents: [],
          email: initial.email,
          organization: { ...initial.organization!, jobTitle: null },
          affiliation: initial,
          person: {
            email: initial.email,
            firstName: "Casey",
            lastName: "Example",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
        },
      }}
    />
  );
}

export function OrganizationReviewDomainPreview() {
  const [name, setName] = useState("");
  return <VerifiedOrganizationNameField domain="" reviewRequired value={name} onChange={setName} validation={{}} />;
}
