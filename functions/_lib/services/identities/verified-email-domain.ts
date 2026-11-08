import {
  resolveDomainOrganization,
  type DomainOrganizationResolution,
  type DomainOwnershipFacts,
} from "../../../../assets/shared/organization-domain";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { organizationDomainCandidates } from "../../email-domains/classification";
import { hostWithinDomainSql } from "../../email-domains/sql";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { normalizeEmail } from "../../validation";
import { organizationLinkDomain } from "../membership/organization-domain-claims";

/** A verified address cannot broaden past an existing more specific organization mapping. */
export function verifiedRepresentationDomainCandidates(email: string, claims: readonly { domain: string }[]): string[] {
  const boundary = Math.max(0, ...claims.map((claim) => claim.domain.length));
  return organizationDomainCandidates(email).filter((domain) => domain.length >= boundary);
}

function ineligibleDomain(): AppError {
  return new AppError(422, "IDENTITY_DOMAIN_INELIGIBLE", "This email domain cannot establish an organization identity");
}

export function requireWorkOrganizationDomain(domain: string | null): string {
  if (!domain) throw ineligibleDomain();
  return domain;
}

/**
 * The domain a verified work address links through — the most specific
 * claimed domain covering it, else its registrable domain — refusing free,
 * disposable and public-suffix mail.
 */
export async function requireOrganizationLinkDomain(db: DatabaseLike, email: string): Promise<string> {
  const domain = await organizationLinkDomain(db, email);
  return requireWorkOrganizationDomain(domain);
}

/** A fact at a merged organization speaks for the organization it was merged into. */
export const FACT_ORGANIZATION = `COALESCE((SELECT merged.merged_into_organization_id FROM organizations merged
  WHERE merged.id = fact.organization_id), fact.organization_id)`;

/**
 * Unknown older provenance can require review, but a current address cannot
 * establish historical ownership. An older fact recorded no domain, so its
 * address counts for the domain when its host is the domain or a subdomain.
 */
export const domainOwnershipFactMatchesSql = (domainSql = "?") => `(fact.verified_email_domain = ${domainSql} OR (
  fact.verified_email_domain IS NULL AND fact.source='verified_email' AND EXISTS (
    SELECT 1 FROM users person LEFT JOIN user_emails address ON address.id=fact.email_id AND address.user_id=person.id
    WHERE person.id=fact.user_id AND ${hostWithinDomainSql(
      "substr(CASE WHEN fact.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END, instr(CASE WHEN fact.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END,'@')+1)",
      domainSql,
    )}
  )
))`;
const domainMatches = domainOwnershipFactMatchesSql();

/** Recheck observed organization resolution in the caller's final atomic command. This grants no domain ownership. */
export function verifiedEmailDomainResolutionEvidence(
  domain: string,
  organizationId: string | null,
  hasAuthoritativeClaim = false,
  confirmedSelection = false,
): AuthorizationEvidence {
  if (confirmedSelection) {
    if (!organizationId)
      return {
        sql: "SELECT 1",
        bindings: [],
      };
    if (hasAuthoritativeClaim)
      return {
        sql: "SELECT 1 FROM organization_domain_claims WHERE domain=? AND organization_id=? AND application_id IS NULL",
        bindings: [domain, organizationId],
      };
    return {
      sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM members WHERE organization_id=?)
        AND EXISTS(SELECT 1 FROM identities fact JOIN users person ON person.id=fact.user_id
          WHERE fact.verified_email_domain=? AND fact.organization_id=? AND fact.source='verified_email'
            AND fact.started_at IS NOT NULL AND fact.ended_at IS NULL AND fact.blocked_at IS NULL AND person.active=1)
        AND NOT EXISTS(SELECT 1 FROM identities fact WHERE ${domainMatches} AND ${FACT_ORGANIZATION}=?
          AND (fact.verified_email_domain IS NULL OR fact.blocked_at IS NOT NULL))`,
      bindings: [organizationId, domain, organizationId, domain, domain, organizationId],
    };
  }
  if (!organizationId)
    return {
      sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM identities fact WHERE ${domainMatches})`,
      bindings: [domain, domain],
    };
  if (hasAuthoritativeClaim)
    return {
      sql: `SELECT 1 WHERE EXISTS (SELECT 1 FROM organization_domain_claims
          WHERE domain=? AND organization_id=? AND application_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM organization_domain_claims
          WHERE domain=? AND (organization_id IS NOT ? OR application_id IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM identities fact WHERE ${domainMatches} AND ${FACT_ORGANIZATION} IS NOT ?)`,
      bindings: [domain, organizationId, domain, organizationId, domain, domain, organizationId],
    };
  return {
    sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain=?)
      AND NOT EXISTS (SELECT 1 FROM members WHERE organization_id=?)
      AND EXISTS (SELECT 1 FROM identities fact JOIN users person ON person.id=fact.user_id
        WHERE fact.verified_email_domain=? AND fact.organization_id=? AND fact.source='verified_email'
          AND fact.started_at IS NOT NULL AND fact.ended_at IS NULL AND fact.blocked_at IS NULL AND person.active=1)
      AND NOT EXISTS (SELECT 1 FROM identities fact WHERE ${domainMatches}
        AND (${FACT_ORGANIZATION} IS NOT ? OR fact.verified_email_domain IS NULL OR fact.blocked_at IS NOT NULL))`,
    bindings: [domain, organizationId, domain, organizationId, domain, domain, organizationId],
  };
}

/** Every fact the shared rule needs to decide who owns one domain. */
export async function loadDomainOwnershipFacts(db: DatabaseLike, domain: string): Promise<DomainOwnershipFacts> {
  const [claims, derived] = await Promise.all([
    all<{ organization_id: string | null; application_id: string | null; member: number }>(
      db,
      `SELECT claim.organization_id, claim.application_id,
        EXISTS(SELECT 1 FROM members WHERE organization_id=claim.organization_id) AS member
       FROM organization_domain_claims claim WHERE claim.domain=? ORDER BY claim.organization_id LIMIT 129`,
      [domain],
    ),
    all<{ id: string; active: number; disputed: number; unknown: number; member: number }>(
      db,
      // A merged organization's facts count for the organization it was merged into.
      `SELECT COALESCE(organization.merged_into_organization_id, organization.id) AS id,
      MAX(CASE WHEN fact.verified_email_domain IS NOT NULL AND fact.source='verified_email' AND fact.started_at IS NOT NULL
        AND fact.ended_at IS NULL AND fact.blocked_at IS NULL AND person.active=1 THEN 1 ELSE 0 END) AS active,
      MAX(CASE WHEN fact.blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS disputed,
      MAX(CASE WHEN fact.verified_email_domain IS NULL THEN 1 ELSE 0 END) AS unknown,
      EXISTS(SELECT 1 FROM members WHERE organization_id=COALESCE(organization.merged_into_organization_id, organization.id)) AS member
      FROM identities fact JOIN organizations organization ON organization.id=fact.organization_id
      JOIN users person ON person.id=fact.user_id WHERE ${domainMatches}
      GROUP BY 1 ORDER BY 1 LIMIT 2`,
      [domain, domain],
    ),
  ]);
  return {
    claimed: claims
      .filter((claim) => claim.organization_id !== null)
      .map((claim) => ({
        organizationId: claim.organization_id!,
        isMember: Boolean(claim.member),
      })),
    heldByApplication: claims.some((claim) => claim.application_id !== null),
    derived: derived.map((fact) => ({
      organizationId: fact.id,
      isMember: Boolean(fact.member),
      active: Boolean(fact.active),
      disputed: Boolean(fact.disputed),
      unknownProvenance: Boolean(fact.unknown),
    })),
  };
}

/**
 * The organization a verified address's link domain belongs to under the
 * shared rule; `domain` is null for free, disposable and public-suffix mail.
 */
export async function resolveEmailDomainOrganization(
  db: DatabaseLike,
  normalizedEmail: string,
): Promise<{ domain: string | null; resolution: DomainOrganizationResolution; facts: DomainOwnershipFacts | null }> {
  const domain = await organizationLinkDomain(db, normalizeEmail(normalizedEmail));
  if (!domain) return { domain: null, resolution: { kind: "none" }, facts: null };
  const facts = await loadDomainOwnershipFacts(db, domain);
  return { domain, resolution: resolveDomainOrganization(facts), facts };
}

/** Only call after mailbox proof; exact retained facts resolve a canonical organization, never a name guess. */
export async function resolveVerifiedEmailDomainOrganization(
  db: DatabaseLike,
  normalizedEmail: string,
): Promise<{ id: string; name: string } | null> {
  const { domain, resolution } = await resolveEmailDomainOrganization(db, normalizedEmail);
  const organizationId = verifiedDomainOrganizationId(domain, resolution);
  if (!organizationId) return null;
  return first<{ id: string; name: string }>(db, "SELECT id,name FROM organizations WHERE id=?", [organizationId]);
}

/** The production domain policy, shared by loaded and prepared affiliation commands. */
export function verifiedDomainOrganizationId(
  domain: string | null,
  resolution: DomainOrganizationResolution,
): string | null {
  requireWorkOrganizationDomain(domain);
  if (resolution.kind === "held")
    throw new AppError(
      409,
      "ORGANIZATION_DOMAIN_IN_USE",
      "This organization domain requires review before affiliation",
    );
  if (resolution.kind === "ambiguous")
    throw new AppError(
      409,
      "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
      "This organization affiliation requires explicit review",
    );
  if (resolution.kind === "none") return null;
  return resolution.organizationId;
}
