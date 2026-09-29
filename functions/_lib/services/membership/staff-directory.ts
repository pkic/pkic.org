/**
 * The member directory as staff read it: one row per membership, never one
 * per representative.
 *
 * Membership belongs to an organization or to an individual. An
 * organization's representatives inherit it rather than each holding one of
 * their own, so an organization with five people is one member, listed once —
 * which is what separates this from `listMemberCapacities`, whose subject is
 * the acting identity rather than the membership.
 *
 * The public directory beside it (`listPublicMembers`) answers the same
 * question for a reader with no standing: active members, and none of the
 * category or status a staff reader needs.
 */
import type { MembersListQuery, StaffMemberSummary } from "../../../../assets/shared/schemas/members-directory";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { organizationLogoUrl } from "../organization-content/fields";
import { publicUserHeadshotPath } from "../user-headshot";

interface StaffMemberRow {
  id: string;
  member_type: "individual" | "organization";
  organization_id: string | null;
  user_id: string | null;
  org_name: string | null;
  org_logo_r2_key: string | null;
  headshot_r2_key: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  category_code: string;
  category_label: string;
  status: string;
  representative_count: number;
  member_since: string;
}

function mapStaffMember(row: StaffMemberRow): StaffMemberSummary {
  const personName = [row.first_name, row.last_name].filter(Boolean).join(" ");
  return {
    id: row.id,
    memberType: row.member_type,
    // A person with no name falls back to their address rather than to
    // "Unknown": staff are the ones who can fix it, and the address is what
    // they need to find them.
    name: row.org_name ?? (personName || row.email) ?? "Unnamed member",
    organizationId: row.organization_id,
    userId: row.user_id,
    imageUrl:
      row.member_type === "organization"
        ? row.organization_id
          ? organizationLogoUrl(row.organization_id, row.org_logo_r2_key)
          : null
        : row.user_id
          ? publicUserHeadshotPath(row.user_id, row.headshot_r2_key)
          : null,
    membershipCategory: row.category_code as StaffMemberSummary["membershipCategory"],
    membershipCategoryLabel: row.category_label,
    status: row.status as StaffMemberSummary["status"],
    representativeCount: row.representative_count,
    memberSince: row.member_since,
  };
}

/** An organization by its name, a person by theirs, and a nameless person by their address. */
const MEMBER_NAME_ORDER =
  "LOWER(COALESCE(o.name, NULLIF(TRIM(COALESCE(u.last_name, '') || ' ' || COALESCE(u.first_name, '')), ''), u.email))";

const STAFF_MEMBER_FROM = `FROM members m
  LEFT JOIN organizations o ON o.id = m.organization_id
  LEFT JOIN users u ON u.id = m.user_id
  JOIN member_category_assignments mca ON mca.member_id = m.id
  JOIN membership_categories mc ON mc.code = mca.category_code`;

/**
 * How many identities currently act for this member.
 *
 * A correlated count rather than a join and a GROUP BY: the page and its
 * count statement share one FROM, and grouping would make the count statement
 * count groups instead of members.
 */
const REPRESENTATIVE_COUNT = `(
  SELECT COUNT(*)
    FROM identity_member_capacities capacity
    JOIN identities identity ON identity.id = capacity.identity_id
   WHERE capacity.member_id = m.id
     AND identity.started_at IS NOT NULL
     AND identity.ended_at IS NULL
     AND identity.blocked_at IS NULL
)`;

export async function listStaffMembers(
  db: DatabaseLike,
  params: MembersListQuery,
): Promise<{ members: StaffMemberSummary[]; total: number }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.group === "independent") conditions.push("m.organization_id IS NULL");
  else if (params.group === "organization") conditions.push("m.organization_id IS NOT NULL");

  if (params.membershipCategory) {
    conditions.push("mca.category_code = ?");
    bindings.push(params.membershipCategory);
  }
  if (params.status) {
    conditions.push("m.status = ?");
    bindings.push(params.status);
  }
  if (params.memberId) {
    conditions.push("m.id = ?");
    bindings.push(params.memberId);
  }
  if (params.representatives) {
    conditions.push(`${REPRESENTATIVE_COUNT} ${params.representatives === "none" ? "= 0" : "> 0"}`);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["o.name", "u.first_name", "u.last_name", "u.email"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }

  const fromSql = `${STAFF_MEMBER_FROM}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}`;
  const { rows, total } = await queryPage<StaffMemberRow>(db, {
    source: {
      selectSql: `SELECT m.id, m.member_type, m.organization_id, m.user_id, o.name AS org_name,
              o.logo_r2_key AS org_logo_r2_key, u.headshot_r2_key,
              u.first_name, u.last_name, u.email, mca.category_code, mc.label AS category_label, m.status,
              ${REPRESENTATIVE_COUNT} AS representative_count,
              COALESCE(m.member_since, m.created_at) AS member_since`,
      fromSql,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      params.sort,
      {
        name: MEMBER_NAME_ORDER,
        membershipCategory: "mca.category_code",
        status: "m.status",
        representativeCount: REPRESENTATIVE_COUNT,
        memberSince: "COALESCE(m.member_since, m.created_at)",
      },
      `${MEMBER_NAME_ORDER} ASC`,
      "m.id ASC",
    ),
    limit: params.limit,
    offset: params.offset,
  });
  return { members: rows.map(mapStaffMember), total };
}
