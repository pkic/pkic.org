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
  OrganizationDomainLinking,
  OrganizationDomainsListQuery,
} from "../../../../assets/shared/schemas/organization-domains";
import { all, first } from "../../db/queries";
import { batchFirst, queryPage } from "../../db/pagination";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
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
import { prepareDomainLinkRun, previewDomainLinking, startDomainLinkRun } from "./domain-link-runs";

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

async function readDomain(db: DatabaseLike, organizationId: string, domain: string): Promise<OrganizationDomain> {
  const [row] = await all<DomainRow>(
    db,
    `${DOMAINS_SQL} SELECT domain, status, people, claimed_at FROM domains WHERE domain = ? LIMIT 1`,
    [organizationId, organizationId, organizationId, domain],
  );
  return toDomain(row!);
}

const INELIGIBLE_DOMAIN = "Free and disposable mail domains and public suffixes never belong to an organization.";

/** Refuses an ineligible or already-owned domain. */
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
      .prepare(`SELECT claim.id,claim.domain,claim.application_id AS applicationId,claim.organization_id AS organizationId,
      EXISTS(SELECT 1 FROM organization_domain_claims entry WHERE entry.domain=claim.domain AND entry.organization_id=?) AS owned
      FROM organization_domain_claims claim WHERE claim.domain=? LIMIT 1`)
      .bind(organizationId, domain),
  ]);
  const organization = batchFirst<{ name: string; merged_into_organization_id: string | null }>(results[0]);
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (organization.merged_into_organization_id)
    throw new AppError(409, "ORGANIZATION_MERGED", `${organization.name} was merged into another organization`);
  const claim = batchFirst<{
    id: string;
    domain: string;
    applicationId: string | null;
    organizationId: string | null;
    owned: number;
  }>(results[1]);
  if (!claim) return null;
  if (claim.owned)
    throw new AppError(409, "ORGANIZATION_DOMAIN_ALREADY_CLAIMED", `This organization already claims ${domain}`);
  return claim;
}

function isDomainClaimRace(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: organization_domain_claims");
}

export async function claimOrganizationDomain(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  organizationId: string,
  input: OrganizationDomainClaimCreate,
): Promise<{ domain: OrganizationDomain; linking: OrganizationDomainLinking }> {
  const existingClaim = await assertClaimable(db, organizationId, input.domain);
  const at = nowIso();
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  const insert = await prepareClaimDomainForOrganization(
    authorizedDb,
    { domain: input.domain, organizationId, now: at },
    null,
  );
  const run = prepareDomainLinkRun(authorizedDb, {
    organizationId,
    domain: input.domain,
    requestedByUserId: actor.id,
    at,
  });
  let savedDomain: DomainRow | null = null;
  try {
    const results = await authorizedDb.batch([
      prepareAuthorizationGuard(authorizedDb, {
        sql: "SELECT 1 FROM organizations WHERE id=? AND merged_into_organization_id IS NULL",
        bindings: [organizationId],
      }),
      ...(existingClaim
        ? [
            prepareAuthorizationGuard(authorizedDb, {
              sql: "SELECT 1 FROM organization_domain_claims WHERE id=? AND domain=? AND application_id IS ? AND organization_id IS ?",
              bindings: [existingClaim.id, input.domain, existingClaim.applicationId, existingClaim.organizationId],
            }),
          ]
        : []),
      insert!,
      ...(!existingClaim ? [run.statement] : []),
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
      ...(existingClaim
        ? [
            authorizedDb
              .prepare(`${DOMAINS_SQL}
        SELECT domain,status,people,claimed_at FROM domains WHERE domain=? LIMIT 1`)
              .bind(organizationId, organizationId, organizationId, input.domain),
          ]
        : []),
    ]);
    if (existingClaim) savedDomain = batchFirst<DomainRow>(results[results.length - 1]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(409, "ORGANIZATION_CHANGED", "The organization changed while the domain was being saved.");
    if (isDomainClaimRace(error))
      throw new AppError(409, "ORGANIZATION_DOMAIN_IN_USE", `${input.domain} was claimed while this was being saved`);
    throw error;
  }
  // Retire the legacy run without automatically creating affiliations.
  const linking = existingClaim ? { peopleLinked: 0, continuing: false } : await startDomainLinkRun(db, run.runId);
  return { domain: savedDomain ? toDomain(savedDomain) : await readDomain(db, organizationId, input.domain), linking };
}

/** What claiming `domain` would do: refused as a claim would be, else how many people it reaches. */
export async function previewOrganizationDomainClaim(
  db: DatabaseLike,
  organizationId: string,
  domain: string,
): Promise<OrganizationDomainClaimPreview> {
  const existingClaim = await assertClaimable(db, organizationId, domain);
  return {
    domain,
    ...(existingClaim ? { shared: true, peopleToLink: 0 } : await previewDomainLinking(db, organizationId, domain)),
  };
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
    if (error instanceof Error && error.message.includes("FOREIGN KEY constraint failed"))
      throw new AppError(
        409,
        "ORGANIZATION_DOMAIN_CHANGED",
        "The domain changed while it was being removed. Try again.",
      );
    throw error;
  }
}
