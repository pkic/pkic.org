import { organizationDomainCandidates } from "../../email-domains/classification";
import { verifiedAffiliationBasisSchema, type VerifiedAffiliationBasis } from "./verified-affiliation-basis";
import type { D1StatementResult } from "../../types";
import { batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
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
  return selectedDomainClaims(claims, selection).map((claim) => ({
    sql: "SELECT 1 FROM organization_domain_claims WHERE id=? AND domain=? AND organization_id=?",
    bindings: [claim.id, claim.domain, claim.organizationId],
  }));
}

/** Canonical bounded claim observation, shared by affiliation reads and application continuations. */
export function domainClaimsObservationSelection(email: string) {
  return {
    sql: `SELECT claim.id,claim.domain,claim.organization_id AS organizationId
      FROM organization_domain_claims claim JOIN json_each(?) requested ON requested.value=claim.domain
      WHERE claim.organization_id IS NOT NULL
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
