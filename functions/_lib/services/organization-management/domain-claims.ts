/**
 * Staff manage the email domains an organization claims.
 *
 * Approved claims can be shared, including with pending applications.
 * Ambiguous domains never automatically affiliate people.
 */
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import type {
  OrganizationDomain,
  OrganizationDomainClaimCreate,
  OrganizationDomainClaimPreview,
  OrganizationDomainsListQuery,
} from "../../../../assets/shared/schemas/organization-domains";
import { first } from "../../db/queries";
import { batchFirst, queryPage } from "../../db/pagination";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { workEmailDomain } from "../../email-domains/classification";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { identityOrganizationEmailDomainSql } from "../identities/affiliation-projection";
import { prepareClaimDomainForOrganization } from "../membership/organization-domain-claims";
import { authorizedOrganizationMutationDb } from "./authorization";
import { domainOwnershipFactMatchesSql, FACT_ORGANIZATION } from "../identities/verified-email-domain";

interface DomainRow {
  domain: string;
  status: OrganizationDomain["status"];
  people: number;
  claimed_at: string | null;
}

const DOMAIN_SORT_EXPRESSIONS = { domain: "domain", people: "people" } as const;

/**
 * Every domain the organization is reached through: its claims, plus the
 * domains its active identities follow without one. A derived domain a
 * pending application holds is `held` until this organization claims it.
 */
const DOMAINS_SQL = `WITH linked AS (
    SELECT identity.user_id, ${identityOrganizationEmailDomainSql("identity.id")} AS domain
      FROM identities identity
     WHERE identity.organization_id = ?
       AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
  ), people AS (
    SELECT domain, COUNT(DISTINCT user_id) AS people FROM linked WHERE domain IS NOT NULL GROUP BY domain
  ), domains AS (
    SELECT claim.domain, 'claimed' AS status, COALESCE(people.people, 0) AS people, claim.created_at AS claimed_at
      FROM organization_domain_claims claim LEFT JOIN people ON people.domain = claim.domain
     WHERE claim.organization_id = ?
    UNION ALL
    SELECT people.domain, CASE WHEN EXISTS (SELECT 1 FROM organization_domain_claims claim
        WHERE claim.domain=people.domain AND claim.application_id IS NOT NULL) THEN 'held' ELSE 'derived' END,
      people.people, NULL
      FROM people
     WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims claim
       WHERE claim.domain=people.domain AND claim.organization_id=?)
  )`;

function toDomain(row: DomainRow): OrganizationDomain {
  return { domain: row.domain, status: row.status, people: Number(row.people), claimedAt: row.claimed_at };
}

export async function listOrganizationDomains(
  db: DatabaseLike,
  organizationId: string,
  query: OrganizationDomainsListQuery,
): Promise<{ domains: OrganizationDomain[]; page: PageInfo }> {
  const organization = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE id = ?", [organizationId]);
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  const search = query.q ? buildD1TextSearchFilter(query.q, ["domain"]) : null;
  const { rows, total } = await queryPage<DomainRow>(db, {
    source: {
      withSql: DOMAINS_SQL,
      selectSql: "SELECT domain, status, people, claimed_at",
      fromSql: `FROM domains${search ? ` WHERE ${search.sql}` : ""}`,
      bindings: [organizationId, organizationId, organizationId, ...(search?.bindings ?? [])],
    },
    orderBy: resolveMappedOrderBy(query.sort, DOMAIN_SORT_EXPRESSIONS, "domain ASC", "domain ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  const domains = rows.map(toDomain);
  return { domains, page: buildPageInfo(query.limit, query.offset, total, domains.length) };
}

const INELIGIBLE_DOMAIN = "Free and disposable mail domains and public suffixes never belong to an organization.";

/** Refuses an ineligible domain or a duplicate claim by this organization. */
async function assertClaimable(db: DatabaseLike, organizationId: string, domain: string) {
  // A registrable domain or an explicit subdomain of one; never mail anyone can sign up for.
  if (!workEmailDomain(domain))
    throw new AppError(422, "ORGANIZATION_DOMAIN_INELIGIBLE", INELIGIBLE_DOMAIN, {
      formErrors: [],
      fieldErrors: { domain: [INELIGIBLE_DOMAIN] },
    });
  const results = await db.batch([
    db.prepare("SELECT name,merged_into_organization_id FROM organizations WHERE id=?").bind(organizationId),
    db
      .prepare(`SELECT
      EXISTS(SELECT 1 FROM organization_domain_claims WHERE domain=? AND organization_id=?) AS owned,
      EXISTS(SELECT 1 FROM organization_domain_claims WHERE domain=?) AS shared`)
      .bind(domain, organizationId, domain),
  ]);
  const organization = batchFirst<{ name: string; merged_into_organization_id: string | null }>(results[0]);
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (organization.merged_into_organization_id)
    throw new AppError(409, "ORGANIZATION_MERGED", `${organization.name} was merged into another organization`);
  const claims = batchFirst<{ owned: number; shared: number }>(results[1])!;
  if (claims.owned)
    throw new AppError(409, "ORGANIZATION_DOMAIN_ALREADY_CLAIMED", `This organization already claims ${domain}`);
  return Boolean(claims.shared);
}

function isDomainClaimRace(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: organization_domain_claims");
}

export async function claimOrganizationDomain(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  organizationId: string,
  input: OrganizationDomainClaimCreate,
): Promise<{ domain: OrganizationDomain }> {
  await assertClaimable(db, organizationId, input.domain);
  const at = nowIso();
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  const insert = await prepareClaimDomainForOrganization(
    authorizedDb,
    { domain: input.domain, organizationId, now: at },
    true,
  );
  let savedDomain: DomainRow | null;
  try {
    const results = await authorizedDb.batch([
      prepareStateGuard(authorizedDb, {
        sql: "SELECT 1 FROM organizations WHERE id=? AND merged_into_organization_id IS NULL",
        bindings: [organizationId],
      }),
      insert!,
      prepareAuditLog(
        authorizedDb,
        "admin",
        actor.id,
        "organization_domain_claimed",
        "organization",
        organizationId,
        { domain: { from: null, to: input.domain }, reason: input.reason },
        at,
      ),
      authorizedDb
        .prepare(`${DOMAINS_SQL}
        SELECT domain,status,people,claimed_at FROM domains WHERE domain=? LIMIT 1`)
        .bind(organizationId, organizationId, organizationId, input.domain),
    ]);
    savedDomain = batchFirst<DomainRow>(results[results.length - 1]);
  } catch (error) {
    if (isStateGuardFailure(error))
      throw new AppError(409, "ORGANIZATION_CHANGED", "The organization changed while the domain was being saved.");
    if (isDomainClaimRace(error))
      throw new AppError(409, "ORGANIZATION_DOMAIN_IN_USE", `${input.domain} was claimed while this was being saved`);
    throw error;
  }
  if (!savedDomain) throw new AppError(500, "ORGANIZATION_DOMAIN_NOT_FOUND", "The saved domain could not be read.");
  return { domain: toDomain(savedDomain) };
}

/** A claim requires confirmation from each person; preview whether its domain is shared. */
export async function previewOrganizationDomainClaim(
  db: DatabaseLike,
  organizationId: string,
  domain: string,
): Promise<OrganizationDomainClaimPreview> {
  const existingClaims = await assertClaimable(db, organizationId, domain);
  const shared = existingClaims
    ? true
    : Boolean(
        await first(
          db,
          `SELECT 1 FROM identities fact WHERE fact.organization_id IS NOT NULL
      AND ${domainOwnershipFactMatchesSql()} AND ${FACT_ORGANIZATION} IS NOT ? LIMIT 1`,
          [domain, domain, organizationId],
        ),
      );
  return { domain, shared };
}

export async function releaseOrganizationDomain(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  organizationId: string,
  domain: string,
): Promise<void> {
  const own = await first<{ id: string }>(
    db,
    "SELECT id FROM organization_domain_claims WHERE domain=? AND organization_id=?",
    [domain, organizationId],
  );
  if (!own) throw new AppError(404, "ORGANIZATION_DOMAIN_NOT_FOUND", "This organization does not claim that domain");
  const at = nowIso();
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  try {
    await authorizedDb.batch([
      authorizedDb
        .prepare("DELETE FROM organization_domain_claims WHERE id=? AND organization_id=?")
        .bind(own.id, organizationId),
      prepareAuditLogAfterOneChange(
        authorizedDb,
        "admin",
        actor.id,
        "organization_domain_released",
        "organization",
        organizationId,
        { domain: { from: domain, to: null } },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error))
      throw new AppError(404, "ORGANIZATION_DOMAIN_NOT_FOUND", "This organization does not claim that domain");
    throw error;
  }
}
