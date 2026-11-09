/**
 * Canonical organization-domain ownership boundary.
 *
 * Provisional applications hold their own claim; selected organizations can
 * reuse an approved claim. Affiliation decisions consider every domain claim.
 *
 * A claim normally holds a registrable domain (`ibm.com`) and covers every
 * address on its subdomains; a subdomain claimed explicitly
 * (`research.ibm.com`) is more specific and wins for the addresses below it.
 */
import { organizationDomainCandidates, workEmailDomain } from "../../email-domains/classification";
import { first } from "../../db/queries";
import { prepareStateGuard } from "../../db/authorization-guard";
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
  organizationId?: string,
): Promise<OrganizationDomainClaim | null> {
  const row = await first<OrganizationDomainClaimRow>(
    db,
    `SELECT id, domain, application_id, organization_id
     FROM organization_domain_claims
     WHERE domain = ? ${organizationId ? "AND organization_id = ?" : ""} ORDER BY application_id IS NULL, id LIMIT 1`,
    organizationId ? [domain, organizationId] : [domain],
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
    WHERE domain IN(SELECT value FROM json_each(?)) ORDER BY length(domain) DESC, application_id IS NULL, id LIMIT 1`,
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
       SELECT ?, ?, ?, NULL, ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM organization_domain_claims claim
         JOIN member_applications application ON application.id=?
         WHERE claim.domain=? AND claim.organization_id=application.organization_id AND claim.application_id IS NULL
       ) AND NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE application_id=? AND domain=?)`,
    )
    .bind(uuid(), domain, applicationId, now, now, applicationId, domain, applicationId, domain);
}

export function prepareReleaseApplicationDomainClaim(db: DatabaseLike, applicationId: string): StatementLike {
  return db.prepare("DELETE FROM organization_domain_claims WHERE application_id = ?").bind(applicationId);
}

export async function prepareTransferApplicationDomainClaim(
  db: DatabaseLike,
  params: { domain: string; applicationId: string; organizationId: string; now: string },
): Promise<StatementLike[]> {
  const claim = await first<{ id: string; application_id: string | null }>(
    db,
    `SELECT id,application_id FROM organization_domain_claims WHERE domain=?
      AND (application_id=? OR (organization_id=? AND application_id IS NULL))
      ORDER BY application_id IS NULL,id LIMIT 1`,
    [params.domain, params.applicationId, params.organizationId],
  );
  if (!claim) {
    const organization = await first<{ name: string; organization_id: string | null }>(
      db,
      `SELECT organization.id AS organization_id, COALESCE(organization.name, application.organization_name) AS name
       FROM member_applications application LEFT JOIN organizations organization ON organization.id=?
       WHERE application.id=?`,
      [params.organizationId, params.applicationId],
    );
    const recovery = organization?.organization_id
      ? "Add it under Email domains, or correct the application's organization before approving."
      : "Correct and save the application's organization name to claim the domain again before approving.";
    throw new AppError(
      409,
      "DOMAIN_CLAIM_LOST",
      `${organization?.name ?? "The application's organization"} no longer has the email domain ${params.domain}. ${recovery}`,
    );
  }
  if (claim.application_id) {
    return [
      prepareStateGuard(db, {
        sql: "SELECT 1 FROM organization_domain_claims WHERE id=? AND domain=? AND application_id=?",
        bindings: [claim.id, params.domain, params.applicationId],
      }),
      db
        .prepare(`DELETE FROM organization_domain_claims WHERE id=? AND application_id=? AND EXISTS (
        SELECT 1 FROM organization_domain_claims WHERE domain=? AND organization_id=?)`)
        .bind(claim.id, params.applicationId, params.domain, params.organizationId),
      db
        .prepare(
          `UPDATE organization_domain_claims SET application_id=NULL, organization_id=?, updated_at=? WHERE id=? AND application_id=?`,
        )
        .bind(params.organizationId, params.now, claim.id, params.applicationId),
    ];
  }
  return [
    prepareStateGuard(db, {
      sql: "SELECT 1 FROM organization_domain_claims WHERE domain=? AND organization_id=? AND application_id IS NULL",
      bindings: [params.domain, params.organizationId],
    }),
  ];
}

export async function prepareClaimDomainForOrganization(
  db: DatabaseLike,
  params: { domain: string; organizationId: string; now: string },
  skipExistingClaimRead = false,
): Promise<StatementLike | null> {
  if (
    !skipExistingClaimRead &&
    (await first<{ id: string }>(db, "SELECT id FROM organization_domain_claims WHERE domain=? AND organization_id=?", [
      params.domain,
      params.organizationId,
    ]))
  )
    return null;
  return db
    .prepare(`INSERT INTO organization_domain_claims
    (id,domain,application_id,organization_id,created_at,updated_at)
    VALUES (?,?,NULL,?,?,?)`)
    .bind(uuid(), params.domain, params.organizationId, params.now, params.now);
}
