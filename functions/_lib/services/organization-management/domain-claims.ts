/**
 * Staff manage the email domains an organization claims.
 *
 * The claim is the existing `organization_domain_claims` row the shared
 * resolver reads: one row per domain, so a domain belongs to at most one
 * organization or one pending application. Adding a claim refuses free and
 * disposable mail, public suffixes and any domain already claimed or held; a domain another
 * organization claims is a duplicate organization, which the refusal names so
 * staff can merge instead. Each add and removal is audited with the reason
 * and the from/to value of the domain.
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
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { workEmailDomain } from "../../email-domains/classification";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { identityOrganizationEmailDomainSql } from "../identities/affiliation-projection";
import {
  getOrganizationDomainClaim,
  prepareClaimDomainForOrganization,
} from "../membership/organization-domain-claims";
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
 * pending application holds is `held`; one another organization claims is
 * not this organization's and is left out, as the resolver leaves it out.
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
    SELECT people.domain, CASE WHEN claim.id IS NULL THEN 'derived' ELSE 'held' END, people.people, NULL
      FROM people LEFT JOIN organization_domain_claims claim ON claim.domain = people.domain
     WHERE claim.id IS NULL OR claim.application_id IS NOT NULL
  )`;

function toDomain(row: DomainRow): OrganizationDomain {
  return { domain: row.domain, status: row.status, people: Number(row.people), claimedAt: row.claimed_at };
}

async function requireLiveOrganization(db: DatabaseLike, organizationId: string): Promise<{ name: string }> {
  const organization = await first<{ name: string; merged_into_organization_id: string | null }>(
    db,
    "SELECT name, merged_into_organization_id FROM organizations WHERE id = ?",
    [organizationId],
  );
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (organization.merged_into_organization_id)
    throw new AppError(409, "ORGANIZATION_MERGED", `${organization.name} was merged into another organization`);
  return organization;
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
      bindings: [organizationId, organizationId, ...(search?.bindings ?? [])],
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
    [organizationId, organizationId, domain],
  );
  return toDomain(row!);
}

const INELIGIBLE_DOMAIN = "Free and disposable mail domains and public suffixes never belong to an organization.";

/** Refuses a domain that cannot become this organization's claim, naming the organization that holds it. */
async function assertClaimable(db: DatabaseLike, organizationId: string, domain: string): Promise<void> {
  // A registrable domain or an explicit subdomain of one; never mail anyone can sign up for.
  if (!workEmailDomain(domain))
    throw new AppError(422, "ORGANIZATION_DOMAIN_INELIGIBLE", INELIGIBLE_DOMAIN, {
      formErrors: [],
      fieldErrors: { domain: [INELIGIBLE_DOMAIN] },
    });
  const claim = await getOrganizationDomainClaim(db, domain);
  if (!claim) return;
  if (claim.organizationId === organizationId)
    throw new AppError(409, "ORGANIZATION_DOMAIN_ALREADY_CLAIMED", `This organization already claims ${domain}`);
  if (claim.applicationId)
    throw new AppError(
      409,
      "ORGANIZATION_DOMAIN_IN_USE",
      `A pending membership application holds ${domain}; decide the application first`,
    );
  const owner = await first<{ id: string; name: string }>(db, "SELECT id, name FROM organizations WHERE id = ?", [
    claim.organizationId,
  ]);
  throw new AppError(
    409,
    "ORGANIZATION_DOMAIN_CLAIMED_ELSEWHERE",
    `${owner?.name ?? "Another organization"} already claims ${domain}; merge the organizations instead`,
    owner ? { organizationId: owner.id, organizationName: owner.name } : undefined,
  );
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
  await requireLiveOrganization(db, organizationId);
  await assertClaimable(db, organizationId, input.domain);
  const at = nowIso();
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  const insert = await prepareClaimDomainForOrganization(authorizedDb, {
    domain: input.domain,
    organizationId,
    now: at,
  });
  const run = prepareDomainLinkRun(authorizedDb, {
    organizationId,
    domain: input.domain,
    requestedByUserId: actor.id,
    at,
  });
  try {
    await authorizedDb.batch([
      insert!,
      run.statement,
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
    ]);
  } catch (error) {
    if (isDomainClaimRace(error))
      throw new AppError(409, "ORGANIZATION_DOMAIN_IN_USE", `${input.domain} was claimed while this was being saved`);
    throw error;
  }
  // Everyone who verified an address on the domain earlier is reached now, or by the scheduler when there are many.
  const linking = await startDomainLinkRun(db, run.runId);
  return { domain: await readDomain(db, organizationId, input.domain), linking };
}

/** What claiming `domain` would do: refused as a claim would be, else how many people it reaches. */
export async function previewOrganizationDomainClaim(
  db: DatabaseLike,
  organizationId: string,
  domain: string,
): Promise<OrganizationDomainClaimPreview> {
  await requireLiveOrganization(db, organizationId);
  await assertClaimable(db, organizationId, domain);
  return { domain, ...(await previewDomainLinking(db, organizationId, domain)) };
}

export async function releaseOrganizationDomain(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  organizationId: string,
  domain: string,
): Promise<void> {
  const claim = await getOrganizationDomainClaim(db, domain);
  if (claim?.organizationId !== organizationId)
    throw new AppError(404, "ORGANIZATION_DOMAIN_NOT_FOUND", "This organization does not claim that domain");
  const at = nowIso();
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  try {
    await authorizedDb.batch([
      authorizedDb
        .prepare("DELETE FROM organization_domain_claims WHERE domain = ? AND organization_id = ?")
        .bind(domain, organizationId),
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
