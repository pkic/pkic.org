import { resolveDomainOrganization } from "../../../../assets/shared/organization-domain";
import { identityAffiliationPreviewResponseSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import { verifiedDomainOrganizationId, verifiedRepresentationDomainCandidates } from "./verified-email-domain";
import { workEmailDomain } from "../../email-domains/classification";
import type { VerifiedAffiliationBasis } from "./verified-affiliation-basis";
import { nowIso } from "../../utils/time";
/** The single organization chooser projection for every verified-mailbox embedding. */
export function verifiedAffiliationPreview(
  basis: VerifiedAffiliationBasis,
  address: { email: string; id?: string | null },
  options: {
    pendingApplicationReview?: boolean;
    /** The mailbox is not recorded for the person yet, so no identity can already use it. */
    unrecordedAddress?: boolean;
  } = {},
) {
  const owned = basis.identities.filter(
    (identity) =>
      !options.unrecordedAddress &&
      identity.organization_id !== null &&
      identity.started_at &&
      identity.started_at <= nowIso() &&
      identity.ended_at === null &&
      identity.blocked_at === null &&
      identity.email_id === (address.id ?? null),
  );
  // The mapping supplies the chooser's default without excluding other proved organizations.
  const resolution = resolveDomainOrganization(
    basis.facts,
    basis.facts.claimed ? { organizationId: basis.facts.claimed.organizationId } : undefined,
  );
  const pendingClaim = resolution.kind === "held" || basis.claims.some((claim) => claim.applicationId);
  if (pendingClaim && !options.pendingApplicationReview && !owned.length)
    verifiedDomainOrganizationId(basis.domain, { kind: "held" });
  const deferAffiliation = pendingClaim && options.pendingApplicationReview;
  const organizationId = deferAffiliation
    ? null
    : resolution.kind === "organization"
      ? resolution.organizationId
      : owned.length === 1
        ? owned[0].organization_id
        : null;
  const organizations = (deferAffiliation ? [] : basis.organizations).filter((organization) => {
    return (
      owned.some((identity) => identity.organization_id === organization.id) ||
      resolveDomainOrganization(basis.facts, { organizationId: organization.id }).kind === "organization"
    );
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
