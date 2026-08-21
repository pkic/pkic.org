import {
  EVENT_TEAM_SORT_COLUMNS,
  type AdminEventPermissionInput,
  type AdminEventTeamListQuery,
  type AdminEventTeamListItem,
  type EventTeamPermission,
} from "../../../../assets/shared/schemas/admin-events";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { requirePermission } from "../../auth/permissions";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { normalizeEmail } from "../../validation";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareAuditLog } from "../audit";
import { getEventBySlug } from "../events";

const PERMISSION_TO_ROLE_ID: Record<EventTeamPermission, string> = {
  organizer: "role-event_organizer",
  program_committee: "role-program_committee",
  moderator: "role-event_moderator",
  volunteer: "role-event_volunteer",
};

const ROLE_ID_TO_PERMISSION: Record<string, EventTeamPermission> = {
  "role-event_organizer": "organizer",
  "role-program_committee": "program_committee",
  "role-event_moderator": "moderator",
  "role-event_volunteer": "volunteer",
};

interface PermissionRow {
  id: string;
  user_email: string | null;
  user_id: string | null;
  role_id: string;
  granted_by_id: string | null;
  expires_at: string | null;
  created_at: string;
  granter_email: string | null;
}

export async function listEventTeam(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventSlug: string,
  query: AdminEventTeamListQuery,
): Promise<{ permissions: AdminEventTeamListItem[]; page: PageInfo }> {
  const event = await getEventBySlug(db, eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const { q, sort, limit, offset } = query;
  const orderBy = resolveMappedOrderBy(
    sort,
    {
      user_email: "ur.user_email",
      role_id: "ur.role_id",
      created_at: "ur.created_at",
      expires_at: "ur.expires_at",
    } satisfies Record<(typeof EVENT_TEAM_SORT_COLUMNS)[number], string>,
    "ur.role_id ASC, ur.user_email ASC",
    "ur.id ASC",
  );
  const search = q ? buildD1TextSearchFilter(q, ["ur.user_email", "ur.role_id"]) : null;
  const searchSql = search ? `AND ${search.sql}` : "";
  const bindings = search?.bindings ?? [];
  const { rows, total } = await queryPage<PermissionRow>(
    db,
    {
      sql: `SELECT ur.id, ur.user_email, ur.user_id, ur.role_id,
                   ur.granted_by_user_id AS granted_by_id, ur.expires_at, ur.created_at,
                   u.email AS granter_email
              FROM user_roles ur
              LEFT JOIN users u ON u.id = ur.granted_by_user_id
             WHERE ur.context_type = 'event' AND ur.context_id = ? AND ur.revoked_at IS NULL
               AND ur.role_id IN ('role-event_organizer', 'role-program_committee', 'role-event_moderator', 'role-event_volunteer')
               ${searchSql} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [event.id, ...bindings, limit, offset],
    },
    {
      sql: `SELECT COUNT(*) AS total FROM user_roles ur
             WHERE ur.context_type = 'event' AND ur.context_id = ? AND ur.revoked_at IS NULL
               AND ur.role_id IN ('role-event_organizer', 'role-program_committee', 'role-event_moderator', 'role-event_volunteer')
               ${searchSql}`,
      bindings: [event.id, ...bindings],
    },
  );
  const permissions = rows.map((row) => ({
    id: row.id,
    user_email: row.user_email,
    user_id: row.user_id,
    permission: ROLE_ID_TO_PERMISSION[row.role_id],
    granted_by_id: row.granted_by_id,
    expires_at: row.expires_at,
    created_at: row.created_at,
    granter_email: row.granter_email,
  }));
  return { permissions, page: buildPageInfo(limit, offset, total, permissions.length) };
}

export async function grantEventTeamRole(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventSlug: string,
  input: AdminEventPermissionInput,
): Promise<Pick<AdminEventTeamListItem, "id" | "user_email" | "permission" | "expires_at" | "created_at">> {
  const event = await getEventBySlug(db, eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const normalizedEmail = normalizeEmail(input.userEmail);
  const roleId = PERMISSION_TO_ROLE_ID[input.permission];
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [normalizedEmail]);
  const id = uuid();
  const now = nowIso();
  const expiresAt = input.expiresAt ?? null;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO user_roles
             (id, user_id, user_email, role_id, context_type, context_id, granted_by_user_id, expires_at, created_at)
           VALUES (?, ?, ?, ?, 'event', ?, ?, ?, ?)`,
        )
        .bind(id, user?.id ?? null, normalizedEmail, roleId, event.id, actor.id, expiresAt, now),
      prepareAuditLog(
        db,
        "admin",
        actor.id,
        "event_permission_granted",
        "event",
        event.id,
        { email: normalizedEmail, permission: input.permission, expiresAt },
        now,
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new AppError(409, "DUPLICATE", "This permission already exists");
    }
    throw error;
  }
  return { id, user_email: normalizedEmail, permission: input.permission, expires_at: expiresAt, created_at: now };
}

export async function revokeEventTeamRole(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventSlug: string,
  permissionId: string,
): Promise<void> {
  const event = await getEventBySlug(db, eventSlug);
  requirePermission(actor, "events:manage", { type: "event", id: event.id });
  const row = await first<{ id: string; user_email: string | null; role_id: string }>(
    db,
    `SELECT id, user_email, role_id FROM user_roles
      WHERE id = ? AND context_type = 'event' AND context_id = ? AND revoked_at IS NULL`,
    [permissionId, event.id],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Permission grant not found");
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE user_roles SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, row.id),
    prepareAuditLog(db, "admin", actor.id, "event_permission_revoked", "event", event.id, {
      email: row.user_email,
      role_id: row.role_id,
    }),
  ]);
}
