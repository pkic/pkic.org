import {
  eventTeamPersonSchema,
  EVENT_TEAM_ROLE_IDS,
  type EventTeamRosterQuery,
} from "../../../../assets/shared/schemas/event-team";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { guardPermissionDatabase, hasPermission, requireAnyPermission } from "../../auth/permissions";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { publicUserHeadshotPath } from "../user-headshot";

/** Union only the rosters this identity can read; membership never confers permission. */
export async function listEventTeamRoster(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  query: EventTeamRosterQuery,
) {
  const context = { type: "event", id: eventId };
  requireAnyPermission(actor, ["events:manage", "agenda:read"], context);
  const access = hasPermission(actor, "events:manage", context);
  const staffing = hasPermission(actor, "agenda:read", context);
  const requirements = [
    ...(access ? [{ permission: "events:manage", context }] : []),
    ...(staffing ? [{ permission: "agenda:read", context }] : []),
  ];
  const guarded = guardPermissionDatabase(
    db,
    actor,
    requirements,
    () => new AppError(409, "TEAM_AUTHORIZATION_CHANGED", "Team permission changed"),
  );
  const search = query.q
    ? buildD1TextSearchFilter(query.q, [
        "COALESCE(subject.first_name,'') || ' ' || COALESCE(subject.last_name,'')",
        "subject.preferred_name",
      ])
    : null;
  const roleIds = Object.values(EVENT_TEAM_ROLE_IDS);
  const roleCase = Object.entries(EVENT_TEAM_ROLE_IDS)
    .map(([role, id]) => `WHEN '${id}' THEN '${role}'`)
    .join(" ");
  const grants = `SELECT ur.id,ur.user_id,ur.role_id,ur.expires_at,ur.created_at FROM user_roles ur WHERE ur.context_type='event' AND ur.context_id=? AND ur.revoked_at IS NULL AND ur.role_id IN (${roleIds.map(() => "?").join(",")}) AND ?=1`;
  const { rows, total } = await queryPage<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    headshot: string | null;
    access_roles: string;
    staffing: string | null;
    duties: string;
  }>(guarded, {
    source: {
      withSql: `WITH grants AS (${grants}), staff AS (SELECT member.event_id,member.user_id,member.roles_json,member.available_from,member.available_until,member.max_minutes,member.seniority,member.attendance_mode, COALESCE(subject.preferred_name,subject.first_name,'Team member') AS display_name FROM event_agenda_role_members member JOIN users subject ON subject.id=member.user_id WHERE member.event_id=? AND ?=1), roster AS (SELECT user_id FROM grants UNION SELECT user_id FROM staff)`,
      selectSql: `SELECT subject.id AS user_id,subject.first_name,subject.last_name,subject.headshot_r2_key AS headshot,
        (SELECT json_group_array(json_object('id',id,'role',CASE role_id ${roleCase} END,'expiresAt',CASE WHEN expires_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) END,'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',created_at))) FROM grants WHERE user_id=subject.id) AS access_roles,
        (SELECT json_object('userId',user_id,'displayName',display_name,'roles',json(roles_json),'availableFrom',available_from,'availableUntil',available_until,'maxMinutes',max_minutes,'seniority',seniority,'attendanceMode',attendance_mode) FROM staff WHERE user_id=subject.id) AS staffing,
        (SELECT json_group_array(role.name) FROM staff JOIN json_each(staff.roles_json) duty JOIN event_agenda_staffing_roles role ON role.event_id=staff.event_id AND role.id=duty.value WHERE staff.user_id=subject.id) AS duties`,
      fromSql: `FROM roster JOIN users subject ON subject.id=roster.user_id WHERE subject.pii_redacted_at IS NULL AND subject.merged_into_user_id IS NULL ${query.userId ? "AND subject.id=?" : ""} ${search ? `AND ${search.sql}` : ""}`,
      bindings: [
        eventId,
        ...roleIds,
        access ? 1 : 0,
        eventId,
        staffing ? 1 : 0,
        ...(query.userId ? [query.userId] : []),
        ...(search?.bindings ?? []),
      ],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { person: "COALESCE(subject.preferred_name,subject.first_name,subject.last_name,'')" },
      "subject.first_name ASC",
      "subject.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  const people = rows.map((row) =>
    eventTeamPersonSchema.parse({
      userId: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      headshotUrl: publicUserHeadshotPath(row.user_id, row.headshot),
      accessRoles: JSON.parse(row.access_roles),
      staffing: row.staffing ? JSON.parse(row.staffing) : null,
      duties: JSON.parse(row.duties),
    }),
  );
  return { people, page: buildPageInfo(query.limit, query.offset, total, people.length) };
}
