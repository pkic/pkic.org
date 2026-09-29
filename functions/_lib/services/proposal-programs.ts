import type { ProposalProgramsListQuery } from "../../../assets/shared/schemas/proposal-programs";
import type { ProposalAccess } from "../../../assets/shared/schemas/event-proposals";
import { queryPage, type OffsetPageQuery } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import type { AuthAdmin, DatabaseLike } from "../types";

const PROPOSAL_PERMISSIONS = [
  "proposals:read",
  "proposals:score",
  "proposals:manage",
  "proposals:edit_accepted_abstract",
  "proposals:cancel_accepted",
] as const;

interface ProposalProgramRow {
  group_id: string;
  group_slug: string;
  group_name: string;
  event_id: string;
  event_slug: string;
  event_name: string;
  event_starts_at: string | null;
  can_read: number;
  can_score: number;
  can_manage: number;
  can_edit_accepted_abstract: number;
  can_cancel_accepted: number;
  event_permissions_json: string;
}

function permittedProposalPermissions(actor: AuthAdmin): readonly (typeof PROPOSAL_PERMISSIONS)[number][] {
  return actor.scopeRestricted
    ? PROPOSAL_PERMISSIONS.filter((permission) => actor.scopes?.includes(permission) === true)
    : PROPOSAL_PERMISSIONS;
}

function permissionEvidence(permission: (typeof PROPOSAL_PERMISSIONS)[number], permitted: readonly string[]): string {
  if (!permitted.includes(permission)) return "0";
  return `(actor.role = 'admin' OR EXISTS (
    SELECT 1 FROM active_permissions permission_row
     WHERE permission_row.permission = '${permission}'
       AND (permission_row.context_type IS NULL OR (permission_row.context_type = 'event' AND permission_row.context_id = event.id))
  ))`;
}

function mapAccess(row: ProposalProgramRow): ProposalAccess {
  const parsed: unknown = JSON.parse(row.event_permissions_json);
  const eventPermissions = Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === "string")
    : [];
  return {
    eventPermissions,
    canRead: row.can_read === 1,
    canReview: row.can_score === 1,
    canFinalize: row.can_manage === 1,
    canEditAcceptedAbstract: row.can_edit_accepted_abstract === 1,
    canCancelAcceptedProposal: row.can_cancel_accepted === 1,
  };
}

/**
 * Bounded selector for program-committee users. Group/event discovery is
 * derived only from proposal permissions; it is intentionally separate from
 * generic group and event resource-grant catalogs.
 */
export function buildProposalProgramsPageQuery(
  actor: AuthAdmin,
  query: ProposalProgramsListQuery,
): OffsetPageQuery | null {
  const permitted = permittedProposalPermissions(actor);
  if (permitted.length === 0) return null;
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["group_row.name", "group_row.slug", "event.name", "event.slug"])
    : null;
  const canRead = permissionEvidence("proposals:read", permitted);
  const canScore = permissionEvidence("proposals:score", permitted);
  const canManage = permissionEvidence("proposals:manage", permitted);
  const canEditAcceptedAbstract = permissionEvidence("proposals:edit_accepted_abstract", permitted);
  const canCancelAccepted = permissionEvidence("proposals:cancel_accepted", permitted);
  const permittedSql = permitted.map((permission) => `'${permission}'`).join(", ");
  const activePermissionsCte = `active_permissions AS MATERIALIZED (
    SELECT role_permission.permission, user_role.context_type, user_role.context_id
      FROM user_roles user_role
      JOIN role_permissions role_permission ON role_permission.role_id = user_role.role_id
     WHERE user_role.user_id = ? AND user_role.revoked_at IS NULL
       AND (user_role.expires_at IS NULL OR user_role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       AND role_permission.permission IN (${permittedSql})
    UNION ALL
    SELECT grant_row.permission, grant_row.context_type, grant_row.context_id
      FROM permission_grants grant_row
     WHERE grant_row.user_id = ? AND grant_row.revoked_at IS NULL
       AND (grant_row.expires_at IS NULL OR grant_row.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       AND grant_row.permission IN (${permittedSql})
  )`;
  const conditions = [canRead];
  const bindings: unknown[] = [actor.id, actor.id, actor.id];
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.groupId) {
    conditions.push("group_row.id = ?");
    bindings.push(query.groupId);
  }
  if (query.eventId) {
    conditions.push("event.id = ?");
    bindings.push(query.eventId);
  }
  // The page needs the complete capability projection. The count repeats the
  // same authority CTE, joins, filters, and bindings, but deliberately omits
  // page-only capability CASE expressions and JSON aggregation.
  const sourcePrefixSql = `WITH actor AS MATERIALIZED (SELECT id, role FROM users WHERE id = ? AND active = 1),
    ${activePermissionsCte}
    `;
  const sourceFromSql = `FROM actor
      JOIN events event ON event.owner_group_id IS NOT NULL
      JOIN groups group_row ON group_row.id = event.owner_group_id AND group_row.active = 1
     WHERE ${conditions.join(" AND ")}`;
  return {
    source: {
      withSql: sourcePrefixSql,
      selectSql: `SELECT group_row.id AS group_id, group_row.slug AS group_slug, group_row.name AS group_name,
        event.id AS event_id, event.slug AS event_slug, event.name AS event_name, event.starts_at AS event_starts_at,
        CASE WHEN ${canRead} THEN 1 ELSE 0 END AS can_read,
        CASE WHEN ${canScore} THEN 1 ELSE 0 END AS can_score,
        CASE WHEN ${canManage} THEN 1 ELSE 0 END AS can_manage,
        CASE WHEN ${canEditAcceptedAbstract} THEN 1 ELSE 0 END AS can_edit_accepted_abstract,
        CASE WHEN ${canCancelAccepted} THEN 1 ELSE 0 END AS can_cancel_accepted,
        COALESCE((SELECT json_group_array(DISTINCT permission_row.permission)
                    FROM active_permissions permission_row
                   WHERE permission_row.context_type = 'event' AND permission_row.context_id = event.id), '[]') AS event_permissions_json`,
      fromSql: sourceFromSql,
      countSelectSql: "SELECT COUNT(*) AS total",
      countFromSql: sourceFromSql,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        groupName: "group_name COLLATE NOCASE",
        eventName: "event_name COLLATE NOCASE",
        startsAt: "event_starts_at",
      },
      "event_name COLLATE NOCASE ASC",
      "event_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listProposalPrograms(
  db: DatabaseLike,
  actor: AuthAdmin,
  query: ProposalProgramsListQuery,
): Promise<{
  programs: Array<{
    group: { id: string; slug: string; name: string };
    event: { id: string; slug: string; name: string; startsAt: string | null };
    access: ProposalAccess;
  }>;
  total: number;
}> {
  const pageQuery = buildProposalProgramsPageQuery(actor, query);
  if (!pageQuery) return { programs: [], total: 0 };
  const page = await queryPage<ProposalProgramRow>(db, pageQuery);
  return {
    programs: page.rows.map((row) => ({
      group: { id: row.group_id, slug: row.group_slug, name: row.group_name },
      event: { id: row.event_id, slug: row.event_slug, name: row.event_name, startsAt: row.event_starts_at },
      access: mapAccess(row),
    })),
    total: page.total,
  };
}
