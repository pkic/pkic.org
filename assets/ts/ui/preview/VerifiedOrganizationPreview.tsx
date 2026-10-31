/** The production chooser and proposal embedding with synthetic verified-mailbox fixtures. */
import { useRef } from "preact/hooks";
import {
  VerifiedOrganizationDetails,
  type VerifiedOrganizationController,
} from "../../components/identities/VerifiedOrganizationDetails";
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
      initial={initial}
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
