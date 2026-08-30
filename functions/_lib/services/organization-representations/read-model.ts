import {
  type OrganizationRepresentative,
  type OrganizationRepresentativesListQuery,
  ORGANIZATION_REPRESENTATIVE_SORT_COLUMNS,
  organizationRepresentativeSchema,
} from "../../../../assets/shared/schemas/organization-representation";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { publicUserHeadshotPath } from "../user-headshot";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";

interface RepresentativeReadRow {
  id: string;
  member_id: string;
  organization_id: string;
  organization_name: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  email_id: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
  source: OrganizationRepresentative["source"];
  show_on_org_profile: number;
  joined_at: string;
  left_at: string | null;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

const SORT_EXPRESSIONS = {
  user_name: "LOWER(COALESCE(user.last_name, '') || ' ' || COALESCE(user.first_name, ''))",
  email: "LOWER(COALESCE(selected_email.email, user.email))",
  organization_name: "LOWER(organization.name)",
  joined_at: "representative.joined_at",
  updated_at: "representative.updated_at",
} satisfies Record<(typeof ORGANIZATION_REPRESENTATIVE_SORT_COLUMNS)[number], string>;

function mapRepresentative(row: RepresentativeReadRow): OrganizationRepresentative {
  return organizationRepresentativeSchema.parse({
    id: row.id,
    memberId: row.member_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    userId: row.user_id,
    userName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    emailId: row.email_id,
    email: row.email,
    jobTitle: row.job_title,
    biography: row.biography,
    links: parseLinksJson(row.links_json),
    headshotUrl: publicUserHeadshotPath(row.headshot_r2_key),
    source: row.source,
    showOnOrganizationProfile: row.show_on_org_profile === 1,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    blockedAt: row.blocked_at,
    blockedByUserId: row.blocked_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listOrganizationRepresentatives(
  db: DatabaseLike,
  organizationId: string,
  query: OrganizationRepresentativesListQuery,
): Promise<{ representatives: OrganizationRepresentative[]; page: PageInfo }> {
  const conditions = ["organization.id = ?"];
  const bindings: unknown[] = [organizationId];
  const search = query.q
    ? buildD1TextSearchFilter(query.q, [
        "COALESCE(selected_email.email, user.email)",
        "user.first_name",
        "user.last_name",
        "organization.name",
        "representative.job_title",
      ])
    : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.memberId) {
    conditions.push("representative.member_id = ?");
    bindings.push(query.memberId);
  }
  if (query.userId) {
    conditions.push("representative.user_id = ?");
    bindings.push(query.userId);
  }
  if (query.active !== undefined) {
    conditions.push(query.active ? "representative.left_at IS NULL" : "representative.left_at IS NOT NULL");
  }
  if (query.blocked !== undefined) {
    conditions.push(query.blocked ? "representative.blocked_at IS NOT NULL" : "representative.blocked_at IS NULL");
  }
  if (query.source) {
    conditions.push("representative.source = ?");
    bindings.push(query.source);
  }
  const fromSql = `FROM organization_representatives representative
    JOIN members member ON member.id = representative.member_id
    JOIN organizations organization ON organization.id = member.organization_id
    JOIN users user ON user.id = representative.user_id
    LEFT JOIN user_emails selected_email ON selected_email.id = representative.email_id
   WHERE ${conditions.join(" AND ")}`;
  const { rows, total } = await queryPage<RepresentativeReadRow>(db, {
    source: {
      selectSql: `SELECT representative.id, representative.member_id,
        organization.id AS organization_id, organization.name AS organization_name,
        representative.user_id, user.first_name, user.last_name,
        COALESCE(selected_email.email, user.email) AS email,
        representative.email_id, representative.job_title, representative.biography, representative.links_json,
        user.headshot_r2_key,
        representative.source, representative.show_on_org_profile,
        representative.joined_at, representative.left_at, representative.blocked_at,
        representative.blocked_by_user_id, representative.created_at, representative.updated_at`,
      fromSql,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      SORT_EXPRESSIONS,
      "representative.joined_at ASC",
      "representative.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  const representatives = rows.map(mapRepresentative);
  return { representatives, page: buildPageInfo(query.limit, query.offset, total, representatives.length) };
}
