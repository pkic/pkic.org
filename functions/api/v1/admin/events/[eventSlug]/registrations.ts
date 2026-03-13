import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, first } from "../../../../../_lib/db/queries";
import type { PagesContext } from "../../../../../_lib/types";

export async function onRequestGet(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const url = new URL(context.request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  const registrations = await all<Record<string, unknown>>(
    context.env.DB,
    `SELECT r.id, r.user_id, r.status, r.attendance_type, r.source_type, r.created_at, r.updated_at,
            u.email AS user_email,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
            rc.code AS referral_code
     FROM registrations r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN referral_codes rc ON rc.owner_type = 'registration' AND rc.owner_id = r.id
     WHERE r.event_id = ?
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [event.id, limit + 1, offset],
  );

  const hasMore = registrations.length > limit;
  const rows = hasMore ? registrations.slice(0, limit) : registrations;

  const totalRow = await first<{ total: number }>(
    context.env.DB,
    "SELECT COUNT(*) AS total FROM registrations WHERE event_id = ?",
    [event.id],
  );
  const total = Number(totalRow?.total ?? 0);

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrations: rows,
    page: {
      limit,
      offset,
      hasMore,
      total,
    },
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestGet(context);
}
