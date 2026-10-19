import { publicGroupProfileIdentityPredicate } from "../groups/profile-publication";
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "../people/profile-publication-sql";
import { publicOrganizationSponsorPredicate } from "../public-sponsors";

/**
 * Extra group/person/sponsor branding consumers, beyond the caller's active Member-page condition.
 * Compare supplied values before a field edit or after a guarded pointer replacement.
 */
export function organizationBrandingPublicationCondition(
  organizationId: string,
  comparedValues: { name?: unknown; website?: unknown; logoR2Key?: unknown },
) {
  const displayChanges: string[] = [],
    personChanges: string[] = [];
  const displayValues: unknown[] = [],
    personValues: unknown[] = [];
  for (const [column, value] of [
    ["name", comparedValues.name],
    ["website", comparedValues.website],
    ["logo_r2_key", comparedValues.logoR2Key],
  ] as const) {
    if (value === undefined) continue;
    displayChanges.push(`organization.${column} IS NOT ?`);
    displayValues.push(value);
    if (column !== "website") {
      personChanges.push(`organization.${column} IS NOT ?`);
      personValues.push(value);
    }
  }
  if (!displayChanges.length) return { sql: "0", bindings: [] };
  return {
    sql: `EXISTS(SELECT 1 FROM organizations organization WHERE organization.id=? AND (
      ((${displayChanges.join(" OR ")}) AND (EXISTS(SELECT 1 FROM identities held
        WHERE held.organization_id=organization.id AND ${publicGroupProfileIdentityPredicate("held")})
        OR ${publicOrganizationSponsorPredicate("organization")}))
      OR ((${personChanges.join(" OR ") || "0"}) AND EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL}
        AND EXISTS(SELECT 1 FROM identities held JOIN organizations represented ON represented.id=held.organization_id
          WHERE held.user_id=person.id AND COALESCE(represented.merged_into_organization_id,represented.id)=organization.id
            AND held.started_at IS NOT NULL AND held.blocked_at IS NULL AND held.hidden_from_public_profile=0)))))`,
    bindings: [organizationId, ...displayValues, ...personValues],
  };
}
