/**
 * GET /api/v1/admin/events/:eventSlug/registrations/:registrationId/audit-log
 *
 * Returns the audit log entries for a specific registration, most recent first.
 * Includes all rows where entity_type = 'registration' and entity_id matches,
 * joined with the users table to surface actor display names.
 */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { first, all } from "../../../../../../../_lib/db/queries";
import type { DatabaseLike } from "../../../../../../../_lib/types";

interface AuditLogRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_display: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details_json: string | null;
  created_at: string;
}

async function fetchAuditLog(
  db: DatabaseLike,
  registrationId: string,
): Promise<AuditLogRow[]> {
  return all<AuditLogRow>(
    db,
    `SELECT
       al.id,
       al.actor_type,
       al.actor_id,
       COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS actor_display,
       al.action,
       al.entity_type,
       al.entity_id,
       al.details_json,
       al.created_at
     FROM audit_log al
     LEFT JOIN users u ON al.actor_type = 'admin' AND u.id = al.actor_id
     WHERE al.entity_type = 'registration' AND al.entity_id = ?
     ORDER BY al.created_at DESC
     LIMIT 200`,
    [registrationId],
  );
}

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const registrationId = c.req.param("registrationId");

  // Verify the registration belongs to this event
  const reg = await first<{ id: string }>(
    c.env.DB,
    "SELECT id FROM registrations WHERE id = ? AND event_id = ?",
    [registrationId, event.id],
  );
  if (!reg) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }

  const entries = await fetchAuditLog(c.env.DB, registrationId);

  // Parse details_json for the caller so it does not have to JSON.parse each row
  const parsed = entries.map((e) => ({
    ...e,
    details: e.details_json ? (() => { try { return JSON.parse(e.details_json); } catch { return null; } })() : null,
    details_json: undefined,
  }));

  return json({ auditLog: parsed });
}
