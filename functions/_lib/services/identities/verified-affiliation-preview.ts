import { resolveDomainOrganization } from "../../../../assets/shared/organization-domain";
import { identityAffiliationPreviewResponseSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import { verifiedDomainOrganizationId, verifiedRepresentationDomainCandidates } from "./verified-email-domain";
import { workEmailDomain } from "../../email-domains/classification";
import type { VerifiedAffiliationBasis } from "./verified-affiliation-basis";
import { nowIso } from "../../utils/time";
/** The single organization chooser projection for every verified-mailbox embedding. */
export function verifiedAffiliationPreview(
  basis: VerifiedAffiliationBasis,
  address: { email: string },
  options: { pendingApplicationReview?: boolean } = {},
) {
  // The mapping supplies the chooser's default without excluding other proved organizations.
  const resolution = resolveDomainOrganization(
    basis.facts,
    basis.facts.claimed ? { organizationId: basis.facts.claimed.organizationId } : undefined,
  );
  const pendingClaim = resolution.kind === "held" || basis.claims.some((claim) => claim.applicationId);
  if (pendingClaim && !options.pendingApplicationReview) verifiedDomainOrganizationId(basis.domain, { kind: "held" });
  const organizationId = !pendingClaim && resolution.kind === "organization" ? resolution.organizationId : null;
  const organizations = (pendingClaim ? [] : basis.organizations).filter((organization) => {
    return resolveDomainOrganization(basis.facts, { organizationId: organization.id }).kind === "organization";
  });
  const organization = organizations.find((item) => item.id === organizationId) ?? null;
  const rootDomain = workEmailDomain(address.email);
  const mayLinkSubdomains = !basis.claims.some((item) => item.applicationId);
  return identityAffiliationPreviewResponseSchema.parse({
    reviewRequired: pendingClaim ? true : undefined,
    email: address.email,
    domain: basis.domain,
    organization: organization ? { id: organization.id, name: organization.name } : null,
    domains: verifiedRepresentationDomainCandidates(address.email, basis.claims).map((domain) => {
      const claim = basis.claims.find((item) => item.domain === domain);
      return {
        domain,
        canLink: !claim && domain !== rootDomain && mayLinkSubdomains,
        organizationName: basis.organizations.find((item) => item.id === claim?.organizationId)?.name ?? null,
      };
    }),
    organizations: organizations.map(({ id, name }) => {
      const identity = basis.identities.find(
        (item) => item.organization_id === id && item.started_at && item.ended_at === null && item.blocked_at === null,
      );
      return { id, name, identityId: identity?.id ?? null, jobTitle: identity?.job_title ?? null };
    }),
    identityId: organizationId
      ? basis.identities.find(
          (identity) =>
            identity.organization_id === organizationId &&
            identity.started_at &&
            identity.started_at <= nowIso() &&
            identity.ended_at === null &&
            identity.blocked_at === null,
        )?.id
      : undefined,
  });
}
