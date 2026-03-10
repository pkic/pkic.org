import { parseJsonBody } from "../../../_lib/validation";
import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { all, first } from "../../../_lib/db/queries";
import { upsertEventFromHugo } from "../../../_lib/services/events";
import { writeAuditLog } from "../../../_lib/services/audit";
import { parseJsonSafe } from "../../../_lib/utils/json";
import type { PagesContext } from "../../../_lib/types";
import type { EventRecord } from "../../../_lib/services/events";
import { adminCreateEventSchema } from "../../../../shared/schemas/api";

interface EventWithStats extends EventRecord {
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
export async function onRequestGet(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const events = await all<EventWithStats>(
    context.env.DB,
    `SELECT
       e.*,
       COUNT(DISTINCT r.id)                                              AS total_registrations,
       COUNT(DISTINCT CASE WHEN r.status = 'registered' THEN r.id END)  AS confirmed_registrations,
       COUNT(DISTINCT CASE WHEN i.status = 'sent'       THEN i.id END)  AS pending_invites
     FROM events e
     LEFT JOIN registrations r ON r.event_id = e.id
     LEFT JOIN invites       i ON i.event_id = e.id
     GROUP BY e.id
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
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminCreateEventSchema);

  // Check slug uniqueness before upsert to give a clear error
  const existing = await first<{ id: string }>(
    context.env.DB,
    "SELECT id FROM events WHERE slug = ?",
    [body.slug],
  );
  if (existing) {
    return json({ error: { code: "SLUG_TAKEN", message: `The slug '${body.slug}' is already in use` } }, 409);
  }

  const settings: Record<string, unknown> = {};
  if (body.venue) settings["venue"] = body.venue;
  if (body.virtualUrl) settings["virtualUrl"] = body.virtualUrl;

  const event = await upsertEventFromHugo(context.env.DB, {
    slug: body.slug,
    name: body.name,
    timezone: body.timezone,
    startsAt: body.startsAt ?? undefined,
    endsAt: body.endsAt ?? undefined,
    registrationMode: body.registrationMode,
    capacityInPerson: body.capacityInPerson ?? undefined,
    inviteLimitAttendee: body.inviteLimitAttendee,
    settings,
  });

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "event_created",
    "event",
    event.id,
    { slug: event.slug },
  );

  return json({
    event: {
      ...event,
      settings: parseJsonSafe<Record<string, unknown>>(event.settings_json, {}),
    },
  }, 201);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
