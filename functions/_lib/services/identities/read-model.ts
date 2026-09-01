import {
  actingIdentitySchema,
  type ActingIdentity,
  type IdentitiesListQuery,
  IDENTITY_SORT_COLUMNS,
} from "../../../../assets/shared/schemas/identity";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { publicUserHeadshotPath } from "../user-headshot";

interface IdentityReadRow {
  id: string;
  member_id: string;
  organization_id: string | null;
  organization_name: string | null;
  membership_category: string;
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

function identityState(row: IdentityReadRow): ActingIdentity["state"] {
  if (row.blocked_at) return "blocked";
  if (row.ended_at) return "ended";
  if (row.started_at) return "active";
  return "pending";
}

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
    headshotUrl: publicUserHeadshotPath(row.headshot_r2_key),
    source: row.source,
    state: identityState(row),
    showOnOrganizationProfile: row.show_on_organization_profile === 1,
    invitedAt: row.invited_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    blockedAt: row.blocked_at,
    blockedByUserId: row.blocked_by_user_id,
    predecessorIdentityId: row.predecessor_identity_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function queryIdentities(
  db: DatabaseLike,
  query: IdentitiesListQuery,
  scope: { organizationId?: string; userId?: string },
): Promise<{ identities: ActingIdentity[]; page: PageInfo }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (scope.organizationId) {
    conditions.push("identity.organization_id = ?");
    bindings.push(scope.organizationId);
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
        "COALESCE(identity.job_title, '')",
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
  const fromSql = `FROM identities identity
    JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
    JOIN users user ON user.id = identity.user_id
    LEFT JOIN organizations organization ON organization.id = identity.organization_id
    LEFT JOIN user_emails selected_email
      ON selected_email.id = identity.email_id
     AND selected_email.user_id = identity.user_id
     AND selected_email.verified_at IS NOT NULL
   ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`;
  const { rows, total } = await queryPage<IdentityReadRow>(db, {
    source: {
      selectSql: `SELECT identity.id, capacity.member_id,
        identity.organization_id, organization.name AS organization_name,
        capacity.membership_category, identity.user_id, user.first_name, user.last_name,
        COALESCE(selected_email.email, user.email) AS email,
        identity.email_id, identity.job_title, identity.biography, identity.links_json,
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
  const identities = rows.map(mapIdentity);
  return { identities, page: buildPageInfo(query.limit, query.offset, total, identities.length) };
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
