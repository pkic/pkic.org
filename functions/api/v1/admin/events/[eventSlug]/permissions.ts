/**
 * GET  /api/v1/admin/events/:eventSlug/permissions  — list event-level roles
 * POST /api/v1/admin/events/:eventSlug/permissions  — grant an event-level role
 */
import { parseJsonBody, normalizeEmail } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { uuid } from "../../../../../_lib/utils/ids";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import type { PagesContext } from "../../../../../_lib/types";
import { adminEventPermissionSchema } from "../../../../../../assets/shared/schemas/api";

interface PermissionRow {
  id: string;
  user_email: string;
  user_id: string | null;
  permission: string;
  granted_by_id: string;
  created_at: string;
  granter_email: string | null;
}

interface ExistingPermRow {
  id: string;
}

export async function onRequestGet(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const permissions = await all<PermissionRow>(
    context.env.DB,
    `SELECT ep.id, ep.user_email, ep.user_id, ep.permission,
            ep.granted_by_id, ep.created_at,
            u.email AS granter_email
     FROM event_permissions ep
     LEFT JOIN users u ON u.id = ep.granted_by_id
     WHERE ep.event_id = ?
     ORDER BY ep.permission ASC, ep.user_email ASC`,
    [event.id],
  );

  return json({ permissions });
}

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminEventPermissionSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const normalizedEmail = normalizeEmail(body.userEmail);

  // Check for duplicate
  const existing = await first<ExistingPermRow>(
    context.env.DB,
    "SELECT id FROM event_permissions WHERE event_id = ? AND user_email = ? AND permission = ?",
    [event.id, normalizedEmail, body.permission],
  );

  if (existing) {
    return json({ error: { code: "DUPLICATE", message: "This permission already exists" } }, 409);
  }

  // Resolve user_id if the person has an account
  const userRow = await first<{ id: string }>(
    context.env.DB,
    "SELECT id FROM users WHERE normalized_email = ?",
    [normalizedEmail],
  );

  const id = uuid();
  const now = nowIso();

  await run(
    context.env.DB,
    `INSERT INTO event_permissions (id, event_id, user_email, user_id, permission, granted_by_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, event.id, normalizedEmail, userRow?.id ?? null, body.permission, admin.id, now],
  );

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "event_permission_granted",
    "event",
    event.id,
    { email: normalizedEmail, permission: body.permission },
  );

  return json({ permission: { id, user_email: normalizedEmail, permission: body.permission, created_at: now } }, 201);
}

export async function onRequest(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
