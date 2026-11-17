import { resolveDomainOrganization } from "../../../../assets/shared/organization-domain";
import { identityAffiliationPreviewResponseSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import { organizationDomainCandidates, workEmailDomain } from "../../email-domains/classification";
import type { VerifiedAffiliationBasis } from "./verified-affiliation-basis";
import { nowIso } from "../../utils/time";
/** The single organization chooser projection for every verified-mailbox embedding. */
export function verifiedAffiliationPreview(
  basis: VerifiedAffiliationBasis,
  address: { email: string; id?: string | null },
  options: {
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
  const resolution = resolveDomainOrganization(basis.facts);
  const organizationId =
    resolution.kind === "organization"
      ? resolution.organizationId
      : resolution.kind !== "ambiguous" && owned.length === 1
        ? owned[0].organization_id
        : null;
  const organizations = basis.organizations.filter((organization) => {
    return (
      owned.some((identity) => identity.organization_id === organization.id) ||
      resolveDomainOrganization(basis.facts, { organizationId: organization.id }).kind === "organization"
    );
  });
  const organization = organizations.find((item) => item.id === organizationId) ?? null;
  const rootDomain = workEmailDomain(address.email);
  return identityAffiliationPreviewResponseSchema.parse({
    email: address.email,
    domain: basis.domain,
    organization: organization ? { id: organization.id, name: organization.name } : null,
    domains: organizationDomainCandidates(address.email).map((domain) => {
      const claims = basis.claims.filter((item) => item.domain === domain);
      return {
        domain,
        canLink: claims.length === 0 && domain !== rootDomain,
        organizationName:
          claims.length === 1
            ? (basis.organizations.find((item) => item.id === claims[0]?.organizationId)?.name ?? null)
            : null,
      };
    }),
    organizations: organizations.map(({ id, name }) => {
      const identity = basis.identities.find(
        (item) => item.organization_id === id && item.started_at && item.ended_at === null && item.blocked_at === null,
      );
      const related = basis.facts.related.find((item) => item.organizationId === id);
      return {
        id,
        name,
        identityId: identity?.id ?? null,
        jobTitle: identity?.job_title ?? null,
        domain: related?.domain ?? null,
      };
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
