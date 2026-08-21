/**
 * GET /api/v1/admin/users
 *
 * Returns a pageable list of users.  Designed for the admin console's user
 * management section; supports filtering by role and a simple email/name search.
 *
 * Query params (see usersListQuerySchema, assets/shared/schemas/admin-users.ts):
 *   role   — filter to a specific role (admin | user | guest)
 *   type   — filter by computed membership type (member | event_attendee | contact_only)
 *   q      — partial match against email or name
 *   sort   — allowlisted column, optionally `-`-prefixed for descending
 *   limit  — max rows (default 50, shared maximum 200)
 *   offset — pagination offset (default 0)
 */
import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { queryPage } from "../../../_lib/db/pagination";
import { buildD1TextSearchFilter } from "../../../_lib/db/search";
import { resolveOrderBy } from "../../../_lib/db/sort";
import { ADMIN_USERS_SORT_COLUMNS, usersListRouteSchema } from "../../../../assets/shared/schemas/admin-users";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { deterministicRepresentativeJoinSql } from "../../../_lib/services/membership/representative-lookup";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { openApiRoute } from "../../../_lib/openapi/route";

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  role: string;
  active: number;
  created_at: string;
  links_json: string | null;
  member_id: string | null;
  member_category: string | null;
  member_status: string | null;
  member_organization_id: string | null;
  member_organization_name: string | null;
  event_participation_count: number;
}

export const UsersList = openApiRoute(usersListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { role, type, sort, limit = 50, offset = 0 } = data.query;
  const search = data.query.q ?? "";

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (role) {
    conditions.push("u.role = ?");
    params.push(role);
  }

  if (type === "member") {
    conditions.push("m.id IS NOT NULL");
  } else if (type === "event_attendee") {
    conditions.push("m.id IS NULL AND EXISTS (SELECT 1 FROM event_participants ep WHERE ep.user_id = u.id)");
  } else if (type === "contact_only") {
    conditions.push("m.id IS NULL AND NOT EXISTS (SELECT 1 FROM event_participants ep WHERE ep.user_id = u.id)");
  }

  if (search) {
    const primary = buildD1TextSearchFilter(search, [
      "u.email",
      "u.first_name",
      "u.last_name",
      "u.first_name || ' ' || u.last_name",
    ]);
    const alternate = buildD1TextSearchFilter(search, ["ue.email"]);
    conditions.push(`(${primary.sql} OR EXISTS (
      SELECT 1 FROM user_emails ue WHERE ue.user_id = u.id AND ${alternate.sql}
    ))`);
    params.push(...primary.bindings, ...alternate.bindings);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveOrderBy(sort, ADMIN_USERS_SORT_COLUMNS, "ORDER BY u.role ASC, u.email ASC", "u.id ASC");

  // "member" covers both an org-less individual (members.user_id set
  // directly) and an organization representative (members.user_id is NULL
  // for org-tied aggregates — migration 0000's CHECK — so a representative
  // resolves only via their own organization_representatives row).
  const listWhere = where.replace(/\bm\.id\b/g, "COALESCE(m.id, mi.id)");

  const { rows: users, total } = await queryPage<UserRow>(
    requestDb(c),
    {
      sql: `SELECT u.id, u.email, u.first_name, u.last_name, u.organization_name, u.role, u.active, u.created_at,
              u.links_json,
              COALESCE(rep.id, mi.id) AS member_id, mca.category_code AS member_category,
              COALESCE(m.status, mi.status) AS member_status,
              m.organization_id AS member_organization_id, o.name AS member_organization_name,
              (SELECT COUNT(*) FROM event_participants ep WHERE ep.user_id = u.id) AS event_participation_count
       FROM users u
       -- A user can represent more than one organization at once (consolidated
       -- migration 0035) — join to a single deterministic representative row (earliest
       -- joined_at) instead of fanning out one result row (and one
       -- duplicate/miscounted page entry) per represented organization.
${deterministicRepresentativeJoinSql("u.id")}
       LEFT JOIN members m ON m.id = rep.member_id
       LEFT JOIN members mi ON mi.user_id = u.id
       LEFT JOIN organizations o ON o.id = m.organization_id
       LEFT JOIN member_category_assignments mca ON mca.member_id = COALESCE(m.id, mi.id)
       ${listWhere}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      bindings: [...params, limit, offset],
    },
    {
      sql: `SELECT COUNT(*) AS total FROM users u
${deterministicRepresentativeJoinSql("u.id")}
       LEFT JOIN members m ON m.id = rep.member_id
       LEFT JOIN members mi ON mi.user_id = u.id
       ${listWhere}`,
      bindings: params,
    },
  );

  return json({
    users: users.map(({ links_json, event_participation_count, ...row }) => ({
      ...row,
      links: parseLinksJson(links_json),
      membership: row.member_id
        ? {
            memberId: row.member_id,
            membershipCategory: row.member_category,
            status: row.member_status,
            organizationId: row.member_organization_id,
            organizationName: row.member_organization_name,
          }
        : null,
      type: row.member_id ? "member" : event_participation_count > 0 ? "event_attendee" : "contact_only",
      eventParticipationCount: event_participation_count,
    })),
    page: buildPageInfo(limit, offset, total, users.length),
  });
});
