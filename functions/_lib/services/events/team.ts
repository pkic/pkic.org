import {
  EVENT_TEAM_ROLE_IDS,
  EVENT_TEAM_SORT_COLUMNS,
  type EventTeamListQuery,
  type EventTeamRole,
  type EventTeamRoleAssignment,
  type EventTeamRoleCreate,
  type EventTeamRoleId,
} from "../../../../assets/shared/schemas/event-team";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { requirePermission } from "../../auth/permissions";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareAuditLogAfterOneChange } from "../audit";
import { commitAccessControlMutation } from "../access-control/authorization";
import { getEventBySlug } from "../events";
import { publicUserHeadshotPath } from "../user-headshot";

const PERSISTED_EVENT_TEAM_ROLE_IDS = Object.values(EVENT_TEAM_ROLE_IDS) as EventTeamRoleId[];
const EVENT_TEAM_ROLE_ID_BINDINGS = PERSISTED_EVENT_TEAM_ROLE_IDS.map(() => "?").join(", ");
const ROLE_ID_TO_ROLE = Object.fromEntries(
  Object.entries(EVENT_TEAM_ROLE_IDS).map(([role, roleId]) => [roleId, role]),
) as Record<EventTeamRoleId, EventTeamRole>;

/**
 * Converts persisted event-team role IDs back into the shared API vocabulary.
 * Unknown IDs indicate corrupted or incomplete role configuration and must not
 * be emitted as an invalid response.
 */
export function eventTeamRoleForRoleId(roleId: string): EventTeamRole {
  const role = ROLE_ID_TO_ROLE[roleId as EventTeamRoleId];
  if (!role) {
    throw new AppError(500, "INVALID_EVENT_TEAM_ROLE", "Event-team data contains an unsupported role");
  }
  return role;
}

interface RoleAssignmentRow {
  id: string;
  user_email: string;
  user_id: string;
  user_first_name: string | null;
  user_last_name: string | null;
  user_headshot_r2_key: string | null;
  role_id: string;
  granted_by_id: string | null;
  expires_at: string | null;
  created_at: string;
  granter_email: string | null;
}

export async function listEventTeam(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventSlug: string,
  query: EventTeamListQuery,
): Promise<{ roles: EventTeamRoleAssignment[]; page: PageInfo }> {
  const event = await getEventBySlug(db, eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const { q, sort, limit, offset } = query;
  const orderBy = resolveMappedOrderBy(
    sort,
    {
      userEmail: "subject.normalized_email",
      role: "ur.role_id",
      createdAt: "ur.created_at",
      expiresAt: "ur.expires_at",
    } satisfies Record<(typeof EVENT_TEAM_SORT_COLUMNS)[number], string>,
    "ur.role_id ASC, subject.normalized_email ASC",
    "ur.id ASC",
  );
  const search = q ? buildD1TextSearchFilter(q, ["subject.normalized_email", "ur.role_id"]) : null;
  const searchSql = search ? `AND ${search.sql}` : "";
  const bindings = search?.bindings ?? [];
  const { rows, total } = await queryPage<RoleAssignmentRow>(db, {
    sql: `SELECT ur.id, subject.normalized_email AS user_email, ur.user_id, ur.role_id,
                   subject.first_name AS user_first_name, subject.last_name AS user_last_name,
                   subject.headshot_r2_key AS user_headshot_r2_key,
                   ur.granted_by_user_id AS granted_by_id,
                   CASE WHEN ur.expires_at IS NULL THEN NULL
                        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ur.expires_at) END AS expires_at,
                   strftime('%Y-%m-%dT%H:%M:%fZ', ur.created_at) AS created_at,
                   u.email AS granter_email
              FROM user_roles ur
              JOIN users subject ON subject.id = ur.user_id
              LEFT JOIN users u ON u.id = ur.granted_by_user_id
             WHERE ur.context_type = 'event' AND ur.context_id = ? AND ur.revoked_at IS NULL
               AND ur.role_id IN (${EVENT_TEAM_ROLE_ID_BINDINGS})
               ${searchSql}`,
    bindings: [event.id, ...PERSISTED_EVENT_TEAM_ROLE_IDS, ...bindings],
    orderBy,
    limit,
    offset,
  });
  const roles = rows.map((row) => ({
    id: row.id,
    userEmail: row.user_email,
    userId: row.user_id,
    userFirstName: row.user_first_name,
    userLastName: row.user_last_name,
    headshotUrl: publicUserHeadshotPath(row.user_id, row.user_headshot_r2_key),
    role: eventTeamRoleForRoleId(row.role_id),
    grantedByUserId: row.granted_by_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    granterEmail: row.granter_email,
  }));
  return { roles, page: buildPageInfo(limit, offset, total, roles.length) };
}

export async function grantEventTeamRole(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventSlug: string,
  input: EventTeamRoleCreate,
): Promise<EventTeamRoleAssignment> {
  const event = await getEventBySlug(db, eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const roleId = EVENT_TEAM_ROLE_IDS[input.role];
  // The person must already exist: a team member is linked, never created.
  const person = await first<{
    id: string;
    normalized_email: string;
    first_name: string | null;
    last_name: string | null;
    headshot_r2_key: string | null;
  }>(
    db,
    `SELECT id, normalized_email, first_name, last_name, headshot_r2_key
       FROM users
      WHERE id = ? AND active = 1 AND merged_into_user_id IS NULL AND pii_redacted_at IS NULL`,
    [input.userId],
  );
  if (!person) throw new AppError(404, "USER_NOT_FOUND", "No active user has this id");
  const userId = person.id;
  const normalizedEmail = person.normalized_email;
  const id = uuid();
  const now = nowIso();
  const expiresAt = input.expiresAt ?? null;
  try {
    await commitAccessControlMutation(
      db,
      actor,
      [{ permission: "events:manage", context: { type: "event", id: event.id } }],
      [
        db
          .prepare(
            `INSERT INTO user_roles
             (id, user_id, role_id, context_type, context_id, granted_by_user_id, expires_at, created_at)
           VALUES (?, ?, ?, 'event', ?, ?, ?, ?)`,
          )
          .bind(id, userId, roleId, event.id, adminDatabaseUserId(actor), expiresAt, now),
        prepareAuditLogAfterOneChange(
          db,
          "admin",
          actor.id,
          "event_team_role_assigned",
          "event",
          event.id,
          { userId, email: normalizedEmail, role: input.role, expiresAt },
          now,
        ),
      ],
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new AppError(409, "DUPLICATE", "This role assignment already exists");
    }
    throw error;
  }
  return {
    id,
    userEmail: normalizedEmail,
    userId,
    userFirstName: person.first_name,
    userLastName: person.last_name,
    headshotUrl: publicUserHeadshotPath(userId, person.headshot_r2_key),
    role: input.role,
    grantedByUserId: adminDatabaseUserId(actor),
    expiresAt,
    createdAt: now,
    granterEmail: actor.email,
  };
}

export async function revokeEventTeamRole(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventSlug: string,
  roleAssignmentId: string,
): Promise<void> {
  const event = await getEventBySlug(db, eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const row = await first<{ id: string; user_email: string; role_id: string }>(
    db,
    `SELECT ur.id, subject.normalized_email AS user_email, ur.role_id
       FROM user_roles ur
       JOIN users subject ON subject.id = ur.user_id
      WHERE ur.id = ? AND ur.context_type = 'event' AND ur.context_id = ? AND ur.revoked_at IS NULL`,
    [roleAssignmentId, event.id],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Event team role assignment not found");
  const now = nowIso();
  await commitAccessControlMutation(
    db,
    actor,
    [{ permission: "events:manage", context: { type: "event", id: event.id } }],
    [
      db.prepare("UPDATE user_roles SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, row.id),
      prepareAuditLogAfterOneChange(db, "admin", actor.id, "event_team_role_revoked", "event", event.id, {
        email: row.user_email,
        role_id: row.role_id,
      }),
    ],
  );
}
