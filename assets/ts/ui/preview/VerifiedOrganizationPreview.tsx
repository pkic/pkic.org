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
/** A parent-domain organization, one reached on the same domain, and one claiming a subdomain below the address. */
const choices = identityAffiliationPreviewResponseSchema.parse({
  ...initial,
  organizations: [
    ...initial.organizations,
    { id: "00000000-0000-4000-8000-000000000012", name: "Example Labs", identityId: null, jobTitle: null },
    {
      id: "00000000-0000-4000-8000-000000000013",
      name: "Example Research Europe",
      identityId: null,
      jobTitle: null,
      domain: "eu.research.example.test",
    },
  ],
});
export function VerifiedOrganizationPreview() {
  const controller = useRef<VerifiedOrganizationController>({});
  return (
    <VerifiedOrganizationDetails
      initial={{ ...choices, organization: null }}
      emailId={null}
      controller={controller.current}
      resolve={async (domain) => ({ ...choices, domain: domain ?? choices.domain })}
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

export function OrganizationBeforeDomainPreview() {
  const [name, setName] = useState("");
  return <VerifiedOrganizationNameField domain="" value={name} onChange={setName} validation={{}} />;
}
