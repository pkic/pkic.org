/**
 * GET  /api/v1/admin/events/:eventSlug/permissions  — list event-level roles
 * POST /api/v1/admin/events/:eventSlug/permissions  — grant an event-level role
 *
 * Backed by `user_roles` (context_type='event') since Phase 2 (PRD §2,
 * migration 0035 §0.2) — the old `event_permissions` table is dropped. The
 * request/response shape (`permission: organizer|program_committee|
 * moderator|volunteer`) is kept unchanged for API compatibility; it now maps
 * to one of the event-scoped built-in roles.
 */
import { parseJsonBody, normalizeEmail } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { uuid } from "../../../../../_lib/utils/ids";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { adminEventPermissionSchema } from "../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

type EventPermissionValue = "organizer" | "program_committee" | "moderator" | "volunteer";

const PERMISSION_TO_ROLE_ID: Record<EventPermissionValue, string> = {
  organizer: "role-event_organizer",
  program_committee: "role-program_committee",
  moderator: "role-event_moderator",
  volunteer: "role-event_volunteer",
};

const ROLE_ID_TO_PERMISSION: Record<string, EventPermissionValue> = {
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

interface ExistingPermRow {
  id: string;
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  requirePermission(admin, "events:manage", { type: "event", id: event.id });

  const rows = await all<PermissionRow>(
    requestDb(c),
    `SELECT ur.id, ur.user_email, ur.user_id, ur.role_id,
            ur.granted_by_user_id AS granted_by_id, ur.expires_at, ur.created_at,
            u.email AS granter_email
     FROM user_roles ur
     LEFT JOIN users u ON u.id = ur.granted_by_user_id
     WHERE ur.context_type = 'event' AND ur.context_id = ? AND ur.revoked_at IS NULL
       AND ur.role_id IN ('role-event_organizer', 'role-program_committee', 'role-event_moderator', 'role-event_volunteer')
     ORDER BY ur.role_id ASC, ur.user_email ASC`,
    [event.id],
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

  return json({ permissions });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventPermissionSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  requirePermission(admin, "events:manage", { type: "event", id: event.id });

  const normalizedEmail = normalizeEmail(body.userEmail);
  const roleId = PERMISSION_TO_ROLE_ID[body.permission as EventPermissionValue];

  const existing = await first<ExistingPermRow>(
    requestDb(c),
    `SELECT id FROM user_roles
     WHERE context_type = 'event' AND context_id = ? AND user_email = ? AND role_id = ? AND revoked_at IS NULL`,
    [event.id, normalizedEmail, roleId],
  );

  if (existing) {
    return json({ error: { code: "DUPLICATE", message: "This permission already exists" } }, 409);
  }

  // Resolve user_id if the person has an account
  const userRow = await first<{ id: string }>(requestDb(c), "SELECT id FROM users WHERE normalized_email = ?", [
    normalizedEmail,
  ]);

  const id = uuid();
  const now = nowIso();
  const expiresAt = body.expiresAt ?? null;

  await run(
    requestDb(c),
    `INSERT INTO user_roles (id, user_id, user_email, role_id, context_type, context_id, granted_by_user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'event', ?, ?, ?, ?)`,
    [id, userRow?.id ?? null, normalizedEmail, roleId, event.id, admin.id, expiresAt, now],
  );

  await writeAuditLog(requestDb(c), "admin", admin.id, "event_permission_granted", "event", event.id, {
    email: normalizedEmail,
    permission: body.permission,
    expiresAt,
  });

  return json(
    {
      permission: {
        id,
        user_email: normalizedEmail,
        permission: body.permission,
        expires_at: expiresAt,
        created_at: now,
      },
    },
    201,
  );
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "POST") return onRequestPost(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
