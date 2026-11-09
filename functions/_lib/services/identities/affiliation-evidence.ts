import { normalizeOrgName } from "../../../../assets/shared/organization-name";
import { organizationDomainCandidates } from "../../email-domains/classification";
import { verifiedAffiliationBasisSchema, type VerifiedAffiliationBasis } from "./verified-affiliation-basis";
import type { D1StatementResult } from "../../types";
import { batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import { sha256Hex } from "../../utils/crypto";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { verifiedRepresentationDomainEvidence } from "./verified-email-domain";
import { ownedIdentityEmailEvidence } from "./owned-email";

export function verifiedDomainIdentityEvidence(input: {
  userId: string;
  normalizedEmail: string;
  emailId: string | null;
  domain: string;
  organizationId: string;
  sessionId?: string;
}): AuthorizationEvidence {
  const address = ownedIdentityEmailEvidence({ ...input, requireVerifiedPrimary: true });
  return {
    sql: `SELECT 1
            FROM organization_domain_claims claim
            JOIN organizations organization ON organization.id = claim.organization_id
           WHERE claim.domain = ?
             AND claim.organization_id = ?
             AND claim.application_id IS NULL
             AND EXISTS (${address.sql})
             AND EXISTS (SELECT 1 FROM users person WHERE person.id = ? AND person.active = 1)
             AND NOT EXISTS (
               SELECT 1 FROM identities blocked
                WHERE blocked.organization_id = claim.organization_id
                  AND blocked.user_id = ?
                  AND blocked.blocked_at IS NOT NULL
             )
             AND (
               ? IS NULL
               OR EXISTS (
                 SELECT 1 FROM sessions session
                  WHERE session.id = ?
                    AND session.user_id = ?
                    AND session.revoked_at IS NULL
                    AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
               )
             )
           LIMIT 1`,
    bindings: [
      input.domain,
      input.organizationId,
      ...address.bindings,
      input.userId,
      input.userId,
      input.sessionId ?? null,
      input.sessionId ?? null,
      input.userId,
    ],
  };
}

/** Freezes nullable membership enrichment for this command's audit scope, without changing affiliation eligibility. */
export function observedOrganizationMembershipEvidence(
  organizationId: string,
  memberId: string | null,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1 WHERE (? IS NULL AND NOT EXISTS (SELECT 1 FROM members WHERE organization_id=?))
                  OR EXISTS (SELECT 1 FROM members WHERE id=? AND organization_id=?)`,
    bindings: [memberId, organizationId, memberId, organizationId],
  };
}

/** A new name on a reserved domain needs review, even when its spelling differs. */
export function pendingOrganizationApplicationClaim(
  basis: VerifiedAffiliationBasis,
  organizationName?: string,
  match: "domain" | "name" = "domain",
) {
  if (!organizationName) return undefined;
  return basis.claims.find(
    (claim) =>
      claim.domain === basis.domain &&
      claim.applicationId &&
      (match === "domain" ||
        (claim.applicationName && normalizeOrgName(claim.applicationName) === normalizeOrgName(organizationName))),
  );
}

export interface DomainClaimSelection {
  domain: string;
  id?: string;
  name: string;
}

function selectedDomainClaims(claims: VerifiedAffiliationBasis["claims"], selection: DomainClaimSelection) {
  return claims.filter((claim) => claim.domain === selection.domain && claim.organizationId === selection.id);
}

/** Pin only the chosen claim; other claimants do not authorize this decision. */
export function observedDomainClaimsEvidence(
  normalizedEmail: string,
  claims: VerifiedAffiliationBasis["claims"],
  selection?: DomainClaimSelection,
): AuthorizationEvidence[] {
  if (!selection)
    return [
      {
        sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain IN (SELECT value FROM json_each(?)))",
        bindings: [JSON.stringify(organizationDomainCandidates(normalizedEmail))],
      },
    ];
  return [
    verifiedRepresentationDomainEvidence(normalizedEmail, selection.domain),
    ...selectedDomainClaims(claims, selection).map((claim) => ({
      sql: "SELECT 1 FROM organization_domain_claims WHERE id=? AND domain=? AND organization_id=? AND application_id IS NULL",
      bindings: [claim.id, claim.domain, claim.organizationId],
    })),
  ];
}

/** New organization creation cannot race a provisional application on the selected domain. */
export function noPendingOrganizationApplicationEvidence(domain: string): AuthorizationEvidence {
  return {
    sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain=? AND application_id IS NOT NULL)",
    bindings: [domain],
  };
}

/** Canonical bounded claim observation, shared by affiliation reads and application continuations. */
export function domainClaimsObservationSelection(email: string) {
  return {
    sql: `SELECT claim.id,claim.domain,claim.application_id AS applicationId,claim.organization_id AS organizationId,
      application.organization_name AS applicationName, application.updated_at AS applicationUpdatedAt,
      EXISTS(SELECT 1 FROM members member WHERE member.organization_id=claim.organization_id) AS member
      FROM organization_domain_claims claim JOIN json_each(?) requested ON requested.value=claim.domain
      LEFT JOIN member_applications application ON application.id=claim.application_id
      ORDER BY length(claim.domain) DESC,claim.id LIMIT 129`,
    bindings: [JSON.stringify(organizationDomainCandidates(email))],
  };
}

export function boundedDomainClaimsRows<T>(result: D1StatementResult): T[] {
  const claims = batchRows<T>(result);
  if (claims.length > 128)
    throw new AppError(
      409,
      "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
      "Contact the PKI Consortium to choose your organization.",
    );
  return claims;
}

export function decodeDomainClaimsObservation(result: D1StatementResult) {
  return verifiedAffiliationBasisSchema.shape.claims.parse(boundedDomainClaimsRows(result));
}

export function domainClaimsObservationFingerprint(
  claims: VerifiedAffiliationBasis["claims"],
  selection: DomainClaimSelection,
) {
  return sha256Hex(
    JSON.stringify({
      domain: selection.domain,
      organizationId: selection.id ?? null,
      name: normalizeOrgName(selection.name),
      claims: selectedDomainClaims(claims, selection).map(({ id, domain, organizationId }) => ({
        id,
        domain,
        organizationId,
      })),
    }),
  );
}
