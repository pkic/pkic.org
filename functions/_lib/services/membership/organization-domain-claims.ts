/**
 * Canonical organization-domain ownership boundary.
 *
 * An organization claims a domain when a person's email challenge links it,
 * or when staff add it. Membership applications never hold a domain.
 * Affiliation decisions consider every domain claim.
 *
 * A claim normally holds a registrable domain (`ibm.com`) and covers every
 * address on its subdomains; a subdomain claimed explicitly
 * (`research.ibm.com`) is more specific and wins for the addresses below it.
 */
import { organizationDomainCandidates, workEmailDomain } from "../../email-domains/classification";
import { first } from "../../db/queries";
import { uuid } from "../../utils/ids";
import type { DatabaseLike, StatementLike } from "../../types";

export interface OrganizationDomainClaim {
  id: string;
  domain: string;
  organizationId: string;
}

interface OrganizationDomainClaimRow {
  id: string;
  domain: string;
  organization_id: string;
}

function toClaim(row: OrganizationDomainClaimRow): OrganizationDomainClaim {
  return { id: row.id, domain: row.domain, organizationId: row.organization_id };
}

export async function getOrganizationDomainClaim(
  db: DatabaseLike,
  domain: string,
  organizationId?: string,
): Promise<OrganizationDomainClaim | null> {
  const row = await first<OrganizationDomainClaimRow>(
    db,
    `SELECT id, domain, organization_id
     FROM organization_domain_claims
     WHERE domain = ? AND organization_id ${organizationId ? "= ?" : "IS NOT NULL"} ORDER BY id LIMIT 1`,
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
    sql: `SELECT id,domain,organization_id FROM organization_domain_claims
    WHERE domain IN(SELECT value FROM json_each(?)) AND organization_id IS NOT NULL ORDER BY length(domain) DESC, id LIMIT 1`,
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
