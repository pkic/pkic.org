/**
 * Canonical organization-domain ownership boundary.
 *
 * A domain has exactly one row throughout its lifecycle. Pending membership
 * applications own it through application_id; approval transfers the row to
 * organization_id. Keeping both states in one table makes duplicate-domain
 * rejection a database invariant instead of a race-prone pair of reads.
 *
 * A claim normally holds a registrable domain (`ibm.com`) and covers every
 * address on its subdomains; a subdomain claimed explicitly
 * (`research.ibm.com`) is more specific and wins for the addresses below it.
 */
import { organizationDomainCandidates, workEmailDomain } from "../../email-domains/classification";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { uuid } from "../../utils/ids";
import type { DatabaseLike, StatementLike } from "../../types";

export interface OrganizationDomainClaim {
  id: string;
  domain: string;
  applicationId: string | null;
  organizationId: string | null;
}

interface OrganizationDomainClaimRow {
  id: string;
  domain: string;
  application_id: string | null;
  organization_id: string | null;
}

function toClaim(row: OrganizationDomainClaimRow): OrganizationDomainClaim {
  return {
    id: row.id,
    domain: row.domain,
    applicationId: row.application_id,
    organizationId: row.organization_id,
  };
}

export async function getOrganizationDomainClaim(
  db: DatabaseLike,
  domain: string,
): Promise<OrganizationDomainClaim | null> {
  const row = await first<OrganizationDomainClaimRow>(
    db,
    `SELECT id, domain, application_id, organization_id
     FROM organization_domain_claims
     WHERE domain = ?`,
    [domain],
  );
  return row ? toClaim(row) : null;
}

/** The most specific claim covering a work address, or null; free and disposable mail never match one. */
export async function getOrganizationDomainClaimForEmail(
  db: DatabaseLike,
  email: string,
): Promise<OrganizationDomainClaim | null> {
  const read = organizationDomainClaimForEmailSelection(email);
  const row = await first<OrganizationDomainClaimRow>(db, read.sql, read.bindings);
  return row ? toClaim(row) : null;
}

/** The same most-specific work-domain lookup, composable into a request's existing batch. */
export function organizationDomainClaimForEmailSelection(email: string) {
  return {
    sql: `SELECT id,domain,application_id,organization_id FROM organization_domain_claims
    WHERE domain IN(SELECT value FROM json_each(?)) ORDER BY length(domain) DESC LIMIT 1`,
    bindings: [JSON.stringify(organizationDomainCandidates(email))],
  };
}

/**
 * The domain a work address links through: the most specific claimed domain
 * covering it, else its registrable domain. Null for free and disposable mail.
 */
export async function organizationLinkDomain(db: DatabaseLike, email: string): Promise<string | null> {
  const claim = await getOrganizationDomainClaimForEmail(db, email);
  return claim?.domain ?? workEmailDomain(email);
}

export function prepareClaimDomainForApplication(
  db: DatabaseLike,
  domain: string,
  applicationId: string,
  now: string,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .bind(uuid(), domain, applicationId, now, now);
}

export function prepareReleaseApplicationDomainClaim(db: DatabaseLike, applicationId: string): StatementLike {
  return db.prepare("DELETE FROM organization_domain_claims WHERE application_id = ?").bind(applicationId);
}

export async function prepareTransferApplicationDomainClaim(
  db: DatabaseLike,
  params: { domain: string; applicationId: string; organizationId: string; now: string },
): Promise<StatementLike> {
  const claim = await getOrganizationDomainClaim(db, params.domain);
  if (!claim || claim.applicationId !== params.applicationId) {
    throw new AppError(409, "DOMAIN_CLAIM_LOST", "The application no longer owns its organization domain");
  }
  return db
    .prepare(
      `UPDATE organization_domain_claims
       SET application_id = NULL, organization_id = ?, updated_at = ?
       WHERE domain = ? AND application_id = ?`,
    )
    .bind(params.organizationId, params.now, params.domain, params.applicationId);
}

export async function prepareClaimDomainForOrganization(
  db: DatabaseLike,
  params: { domain: string; organizationId: string; now: string },
  /** The caller must guard this observation in its atomic write when supplied. */
  observedClaim?: OrganizationDomainClaim | null,
): Promise<StatementLike | null> {
  const claim = observedClaim === undefined ? await getOrganizationDomainClaim(db, params.domain) : observedClaim;
  if (claim) {
    if (claim.organizationId === params.organizationId) return null;
    throw new AppError(409, "ORGANIZATION_DOMAIN_IN_USE", "This organization domain is already claimed");
  }
  return db
    .prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?)`,
    )
    .bind(uuid(), params.domain, params.organizationId, params.now, params.now);
}
