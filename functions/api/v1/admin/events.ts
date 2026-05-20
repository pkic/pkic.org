import { parseJsonBody } from "../../../_lib/validation";
import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { all, first } from "../../../_lib/db/queries";
import { upsertEventFromHugo } from "../../../_lib/services/events";
import { writeAuditLog } from "../../../_lib/services/audit";
import { parseJsonSafe } from "../../../_lib/utils/json";
import { adminCreateEventSchema } from "../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

interface EventWithStats {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  source_path: string | null;
  base_path: string | null;
  registration_mode: string;
  invite_limit_attendee: number;
  settings_json: string;
  created_at: string;
  updated_at: string;
  total_registrations: number;
  confirmed_registrations: number;
  pending_invites: number;
}

/**
 * GET /api/v1/admin/events
 *
 * Returns all events with aggregate registration and invite counts.
 * Supports both session-token auth and ADMIN_API_KEY.
 */
export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const events = await all<EventWithStats>(
    requestDb(c),
    `WITH registration_counts AS (
       SELECT event_id,
              COUNT(*) AS total_registrations,
              SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) AS confirmed_registrations
       FROM registrations
       GROUP BY event_id
     ),
     invite_counts AS (
       SELECT event_id, COUNT(*) AS pending_invites
       FROM invites
       WHERE status = 'sent' AND invite_type = 'attendee'
       GROUP BY event_id
     )
     SELECT
       e.id,
       e.slug,
       e.name,
       e.timezone,
       e.starts_at,
       e.ends_at,
       e.source_path,
       e.base_path,
       e.registration_mode,
       e.invite_limit_attendee,
       e.settings_json,
       e.created_at,
       e.updated_at,
       COALESCE(registration_counts.total_registrations, 0) AS total_registrations,
       COALESCE(registration_counts.confirmed_registrations, 0) AS confirmed_registrations,
       COALESCE(invite_counts.pending_invites, 0) AS pending_invites
     FROM events e
     LEFT JOIN registration_counts ON registration_counts.event_id = e.id
     LEFT JOIN invite_counts ON invite_counts.event_id = e.id
     ORDER BY COALESCE(e.starts_at, '9999') DESC`,
    [],
  );

  return json({ events });
}

/**
 * POST /api/v1/admin/events
 *
 * Creates a new event from the admin console. The slug must be unique.
 */
export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminCreateEventSchema);

  // Check slug uniqueness before upsert to give a clear error
  const existing = await first<{ id: string }>(requestDb(c), "SELECT id FROM events WHERE slug = ?", [body.slug]);
  if (existing) {
    return json({ error: { code: "SLUG_TAKEN", message: `The slug '${body.slug}' is already in use` } }, 409);
  }

  const settings: Record<string, unknown> = {};
  if (body.venue) settings["venue"] = body.venue;
  if (body.virtualUrl) settings["virtualUrl"] = body.virtualUrl;

  const event = await upsertEventFromHugo(requestDb(c), {
    slug: body.slug,
    name: body.name,
    timezone: body.timezone,
    startsAt: body.startsAt ?? undefined,
    endsAt: body.endsAt ?? undefined,
    registrationMode: body.registrationMode,
    inviteLimitAttendee: body.inviteLimitAttendee,
    settings,
  });

  await writeAuditLog(requestDb(c), "admin", admin.id, "event_created", "event", event.id, { slug: event.slug });

  return json(
    {
      event: {
        ...event,
        settings: parseJsonSafe<Record<string, unknown>>(event.settings_json, {}),
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
