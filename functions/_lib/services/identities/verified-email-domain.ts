import {
  emailDomainOf,
  isDisposableEmailDomain,
  isPersonalEmailDomain,
} from "../../../../assets/shared/constants/email-domains";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { normalizeEmail } from "../../validation";
import { getOrganizationDomainClaim } from "../membership/organization-domain-claims";

export function requireOrganizationEmailDomain(email: string): string {
  const domain = emailDomainOf(email);
  if (!domain || isPersonalEmailDomain(domain) || isDisposableEmailDomain(domain))
    throw new AppError(
      422,
      "IDENTITY_DOMAIN_INELIGIBLE",
      "This email domain cannot establish an organization identity",
    );
  return domain;
}

/** Unknown older provenance can require review, but a current address cannot establish historical ownership. */
const domainMatches = `(fact.verified_email_domain = ? OR (
  fact.verified_email_domain IS NULL AND fact.source='verified_email' AND EXISTS (
    SELECT 1 FROM users person LEFT JOIN user_emails address ON address.id=fact.email_id AND address.user_id=person.id
    WHERE person.id=fact.user_id AND substr(
      CASE WHEN fact.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END,
      instr(CASE WHEN fact.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END,'@')+1
    ) = ?
  )
))`;

/** Recheck observed organization resolution in the caller's final atomic command. This grants no domain ownership. */
export function verifiedEmailDomainResolutionEvidence(
  domain: string,
  organizationId: string | null,
  hasAuthoritativeClaim = false,
): AuthorizationEvidence {
  if (!organizationId)
    return {
      sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM identities fact WHERE ${domainMatches})`,
      bindings: [domain, domain],
    };
  if (hasAuthoritativeClaim)
    return {
      sql: `SELECT 1 WHERE EXISTS (SELECT 1 FROM organization_domain_claims
          WHERE domain=? AND organization_id=? AND application_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM identities fact WHERE ${domainMatches} AND fact.organization_id IS NOT ?)`,
      bindings: [domain, organizationId, domain, domain, organizationId],
    };
  return {
    sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain=?)
      AND NOT EXISTS (SELECT 1 FROM members WHERE organization_id=?)
      AND EXISTS (SELECT 1 FROM identities fact JOIN users person ON person.id=fact.user_id
        WHERE fact.verified_email_domain=? AND fact.organization_id=? AND fact.source='verified_email'
          AND fact.started_at IS NOT NULL AND fact.ended_at IS NULL AND fact.blocked_at IS NULL AND person.active=1)
      AND NOT EXISTS (SELECT 1 FROM identities fact WHERE ${domainMatches}
        AND (fact.organization_id IS NOT ? OR fact.verified_email_domain IS NULL OR fact.blocked_at IS NOT NULL))`,
    bindings: [domain, organizationId, domain, organizationId, domain, domain, organizationId],
  };
}

/** Only call after mailbox proof; exact retained facts resolve a canonical organization, never a name guess. */
export async function resolveVerifiedEmailDomainOrganization(
  db: DatabaseLike,
  normalizedEmail: string,
): Promise<{ id: string; name: string } | null> {
  const domain = requireOrganizationEmailDomain(normalizeEmail(normalizedEmail));
  const claim = await getOrganizationDomainClaim(db, domain);
  if (claim?.applicationId || (claim && !claim.organizationId))
    throw new AppError(
      409,
      "ORGANIZATION_DOMAIN_IN_USE",
      "This organization domain requires review before affiliation",
    );
  const candidates = await all<{
    id: string;
    name: string;
    active: number;
    disputed: number;
    unknown: number;
    member: number;
  }>(
    db,
    `SELECT organization.id,organization.name,
    MAX(CASE WHEN fact.verified_email_domain IS NOT NULL AND fact.source='verified_email' AND fact.started_at IS NOT NULL
      AND fact.ended_at IS NULL AND fact.blocked_at IS NULL AND person.active=1 THEN 1 ELSE 0 END) AS active,
    MAX(CASE WHEN fact.blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS disputed,
    MAX(CASE WHEN fact.verified_email_domain IS NULL THEN 1 ELSE 0 END) AS unknown,
    EXISTS(SELECT 1 FROM members WHERE organization_id=organization.id) AS member
    FROM identities fact JOIN organizations organization ON organization.id=fact.organization_id
    JOIN users person ON person.id=fact.user_id WHERE ${domainMatches}
    GROUP BY organization.id,organization.name ORDER BY organization.id LIMIT 2`,
    [domain, domain],
  );
  if (claim?.organizationId && !candidates.some((candidate) => candidate.id !== claim.organizationId))
    return first<{ id: string; name: string }>(db, "SELECT id,name FROM organizations WHERE id=?", [
      claim.organizationId,
    ]);
  if (!claim && candidates.length === 0) return null;
  const candidate = candidates[0];
  if (
    claim ||
    candidates.length !== 1 ||
    !candidate.active ||
    candidate.disputed ||
    candidate.unknown ||
    candidate.member
  )
    throw new AppError(
      409,
      "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
      "This organization affiliation requires explicit review",
    );
  return { id: candidate.id, name: candidate.name };
}
