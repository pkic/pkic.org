import { persistedUtcInstant } from "../../utils/time";
import {
  actingIdentitySchema,
  identitiesListQuerySchema,
  type ActingIdentity,
  type IdentitiesListQuery,
  IDENTITY_SORT_COLUMNS,
} from "../../../../assets/shared/schemas/identity";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { publicUserHeadshotPath } from "../user-headshot";
import { identityJobTitleSql } from "./affiliation-projection";

interface IdentityReadRow {
  state: ActingIdentity["state"];
  id: string;
  member_id: string | null;
  organization_id: string | null;
  organization_name: string | null;
  membership_category: string | null;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  email_id: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
  source: ActingIdentity["source"];
  show_on_organization_profile: number;
  invited_at: string;
  started_at: string | null;
  ended_at: string | null;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
  predecessor_identity_id: string | null;
  created_at: string;
  updated_at: string;
}

const SORT_EXPRESSIONS = {
  user_name: "LOWER(COALESCE(user.last_name, '') || ' ' || COALESCE(user.first_name, ''))",
  email: "LOWER(COALESCE(selected_email.email, user.email))",
  organization_name: "LOWER(COALESCE(organization.name, ''))",
  started_at: "identity.started_at",
  updated_at: "identity.updated_at",
} satisfies Record<(typeof IDENTITY_SORT_COLUMNS)[number], string>;

const IDENTITY_STATE_SQL = `CASE WHEN identity.blocked_at IS NOT NULL THEN 'blocked'
  WHEN identity.ended_at IS NOT NULL THEN 'ended'
  WHEN identity.started_at IS NOT NULL THEN 'active' ELSE 'pending' END`;

function mapIdentity(row: IdentityReadRow): ActingIdentity {
  return actingIdentitySchema.parse({
    id: row.id,
    memberId: row.member_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
    userId: row.user_id,
    userName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    emailId: row.email_id,
    email: row.email,
    jobTitle: row.job_title,
    biography: row.biography,
    links: parseLinksJson(row.links_json),
    headshotUrl: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
    source: row.source,
    state: row.state,
    showOnOrganizationProfile: row.show_on_organization_profile === 1,
    invitedAt: persistedUtcInstant(row.invited_at),
    startedAt: persistedUtcInstant(row.started_at),
    endedAt: persistedUtcInstant(row.ended_at),
    blockedAt: persistedUtcInstant(row.blocked_at),
    blockedByUserId: row.blocked_by_user_id,
    predecessorIdentityId: row.predecessor_identity_id,
    createdAt: persistedUtcInstant(row.created_at),
    updatedAt: persistedUtcInstant(row.updated_at),
  });
}

type OrganizationContactUserIds = readonly [string | null, string | null, string | null];

export function prepareIdentitiesList(
  db: DatabaseLike,
  query: IdentitiesListQuery,
  scope: { organizationId?: string; userId?: string; contactUserIds?: OrganizationContactUserIds },
) {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (scope.organizationId) {
    conditions.push("identity.organization_id = ?");
    bindings.push(scope.organizationId);
  }
  if (scope.contactUserIds) {
    conditions.push("user.active = 1", "identity.user_id IN (?, ?, ?)");
    bindings.push(...scope.contactUserIds);
  }
  if (scope.userId) {
    conditions.push("identity.user_id = ?");
    bindings.push(scope.userId);
  }
  const search = query.q
    ? buildD1TextSearchFilter(query.q, [
        "COALESCE(selected_email.email, user.email)",
        "user.first_name",
        "user.last_name",
        "COALESCE(organization.name, '')",
        `COALESCE(${identityJobTitleSql("identity.id")}, '')`,
      ])
    : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.memberId) {
    conditions.push("capacity.member_id = ?");
    bindings.push(query.memberId);
  }
  if (query.organizationId) {
    conditions.push("identity.organization_id = ?");
    bindings.push(query.organizationId);
  }
  if (query.state) {
    conditions.push(`(${IDENTITY_STATE_SQL}) = ?`);
    bindings.push(query.state);
  }
  if (query.organizationOnly) conditions.push("identity.organization_id IS NOT NULL");
  if (query.identityId) {
    conditions.push("identity.id=?");
    bindings.push(query.identityId);
  }
  if (query.excludeOrganizationId) {
    conditions.push("(identity.organization_id IS NULL OR identity.organization_id<>?)");
    bindings.push(query.excludeOrganizationId);
  }
  if (query.excludeIdentityId) {
    conditions.push("identity.id<>?");
    bindings.push(query.excludeIdentityId);
  }
  if (query.userId) {
    conditions.push("identity.user_id = ?");
    bindings.push(query.userId);
  }
  if (query.active !== undefined) {
    conditions.push(
      query.active
        ? "identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL"
        : "NOT (identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL)",
    );
  }
  if (query.blocked !== undefined) {
    conditions.push(query.blocked ? "identity.blocked_at IS NOT NULL" : "identity.blocked_at IS NULL");
  }
  if (query.source) {
    conditions.push("identity.source = ?");
    bindings.push(query.source);
  }
  if (query.emailDomain) {
    conditions.push(
      "substr(COALESCE(selected_email.normalized_email, user.normalized_email), instr(COALESCE(selected_email.normalized_email, user.normalized_email), '@') + 1) = ?",
    );
    bindings.push(query.emailDomain);
  }
  const fromSql = `FROM identities identity
    LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
    JOIN users user ON user.id = identity.user_id
    LEFT JOIN organizations organization ON organization.id = identity.organization_id
    LEFT JOIN user_emails selected_email
      ON selected_email.id = identity.email_id
     AND selected_email.user_id = identity.user_id
     AND selected_email.verified_at IS NOT NULL
   ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`;
  const statements = buildOffsetPageStatements(db, {
    source: {
      selectSql: `SELECT identity.id, ${IDENTITY_STATE_SQL} AS state, capacity.member_id,
        identity.organization_id, organization.name AS organization_name,
        capacity.membership_category, identity.user_id, user.first_name, user.last_name,
        COALESCE(selected_email.email, user.email) AS email,
        identity.email_id, ${identityJobTitleSql("identity.id")} AS job_title, identity.biography, identity.links_json,
        user.headshot_r2_key, identity.source, identity.show_on_organization_profile,
        identity.invited_at, identity.started_at, identity.ended_at, identity.blocked_at,
        identity.blocked_by_user_id, identity.predecessor_identity_id,
        identity.created_at, identity.updated_at`,
      fromSql,
      bindings,
    },
    orderBy: resolveMappedOrderBy(query.sort, SORT_EXPRESSIONS, "identity.invited_at ASC", "identity.id ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  return {
    statements,
    decode(loaded: D1StatementResult[]) {
      const { rows, total } = decodeOffsetPageResults<IdentityReadRow>(loaded[0]!, loaded[1]!);
      const identities = rows.map(mapIdentity);
      return { identities, page: buildPageInfo(query.limit, query.offset, total, identities.length) };
    },
  };
}

async function queryIdentities(
  db: DatabaseLike,
  query: IdentitiesListQuery,
  scope: { organizationId?: string; userId?: string; contactUserIds?: OrganizationContactUserIds },
) {
  const read = prepareIdentitiesList(db, query, scope);
  return read.decode(await db.batch(read.statements));
}

export function listOrganizationIdentities(
  db: DatabaseLike,
  organizationId: string,
  query: IdentitiesListQuery,
): Promise<{ identities: ActingIdentity[]; page: PageInfo }> {
  return queryIdentities(db, query, { organizationId });
}

export function listUserIdentities(
  db: DatabaseLike,
  userId: string,
  query: IdentitiesListQuery,
): Promise<{ identities: ActingIdentity[]; page: PageInfo }> {
  return queryIdentities(db, query, { userId });
}

/** Resolve only the two contact holders and pending nominee through the canonical identity projection. */
export async function readOrganizationContactIdentities(
  db: DatabaseLike,
  memberId: string,
  contactUserIds: OrganizationContactUserIds,
): Promise<ActingIdentity[]> {
  const result = await queryIdentities(db, identitiesListQuerySchema.parse({ memberId, active: true, limit: 3 }), {
    contactUserIds,
  });
  return result.identities;
}
