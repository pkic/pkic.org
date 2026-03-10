/**
 * GET /api/v1/admin/events/:eventSlug
 *
 * Returns the full event record including settings_json fields (venue,
 * virtualUrl, etc.) so the admin UI can populate the Details / Settings form.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { first } from "../../../../../_lib/db/queries";
import { parseJsonSafe } from "../../../../../_lib/utils/json";
import type { PagesContext } from "../../../../../_lib/types";

interface RetentionPolicyRow {
  user_retention_days: number;
}

export async function onRequestGet(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const retention = await first<RetentionPolicyRow>(
    context.env.DB,
    "SELECT user_retention_days FROM retention_policies WHERE event_id = ?",
    [event.id],
  );

  const settings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});

  return json({
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      timezone: event.timezone,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      base_path: event.base_path,
      capacity_in_person: event.capacity_in_person,
      registration_mode: event.registration_mode,
      invite_limit_attendee: event.invite_limit_attendee,
      user_retention_days: retention?.user_retention_days ?? null,
      venue: (settings.venue as string | null) ?? null,
      virtual_url: (settings.virtualUrl as string | null) ?? null,
      settings,
    },
  });
}

export async function onRequest(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
