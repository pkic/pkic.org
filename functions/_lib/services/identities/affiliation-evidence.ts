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
