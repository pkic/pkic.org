import { organizationDomainCandidates } from "../../email-domains/classification";
import { verifiedAffiliationBasisSchema, type VerifiedAffiliationBasis } from "./verified-affiliation-basis";
import type { D1StatementResult } from "../../types";
import { batchRows } from "../../db/pagination";
import { sha256Hex } from "../../utils/crypto";
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

/** Pins the complete domain and pending-application observations through the atomic write. */
export function observedDomainClaimsEvidence(
  normalizedEmail: string,
  claims: VerifiedAffiliationBasis["claims"],
): AuthorizationEvidence[] {
  const observed = JSON.stringify(claims);
  const domains = JSON.stringify(organizationDomainCandidates(normalizedEmail));
  const applications = JSON.stringify(
    claims
      .filter((claim) => claim.applicationId)
      .map((claim) => ({
        id: claim.applicationId,
        name: claim.applicationName ?? null,
        updatedAt: claim.applicationUpdatedAt ?? null,
      })),
  );
  return [
    {
      sql: `SELECT 1 WHERE NOT EXISTS (
      SELECT id,domain,organization_id,application_id FROM organization_domain_claims WHERE domain IN (SELECT value FROM json_each(?))
      EXCEPT SELECT json_extract(value,'$.id'),json_extract(value,'$.domain'),json_extract(value,'$.organizationId'),json_extract(value,'$.applicationId') FROM json_each(?)
    ) AND NOT EXISTS (
      SELECT json_extract(value,'$.id'),json_extract(value,'$.domain'),json_extract(value,'$.organizationId'),json_extract(value,'$.applicationId') FROM json_each(?)
      EXCEPT SELECT id,domain,organization_id,application_id FROM organization_domain_claims WHERE domain IN (SELECT value FROM json_each(?))
    )`,
      bindings: [domains, observed, observed, domains],
    },
    {
      sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM json_each(?) observed WHERE NOT EXISTS (
      SELECT 1 FROM member_applications application WHERE application.id=json_extract(observed.value,'$.id')
        AND application.organization_name IS json_extract(observed.value,'$.name')
        AND application.updated_at IS json_extract(observed.value,'$.updatedAt')
    ))`,
      bindings: [applications],
    },
  ];
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

export function decodeDomainClaimsObservation(result: D1StatementResult) {
  return verifiedAffiliationBasisSchema.shape.claims.parse(batchRows(result));
}

export function domainClaimsObservationFingerprint(claims: VerifiedAffiliationBasis["claims"]) {
  return sha256Hex(JSON.stringify(verifiedAffiliationBasisSchema.shape.claims.parse(claims)));
}
