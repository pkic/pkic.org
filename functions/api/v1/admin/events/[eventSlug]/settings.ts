/**
 * PATCH /api/v1/admin/events/:eventSlug/settings
 *
 * Updates both core event details (name, timezone, start/end dates) and
 * registration settings (mode, capacity, invite limit). The venue and
 * virtualUrl convenience fields are persisted inside settings_json.
 * Returns the complete updated event record.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { run, first } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { parseJsonSafe, stringifyJson } from "../../../../../_lib/utils/json";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import type { PagesContext } from "../../../../../_lib/types";
import { adminEventSettingsSchema } from "../../../../../../shared/schemas/api";

export async function onRequestPatch(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminEventSettingsSchema);

  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  // ── Merge settings_json — preserve existing keys and fold in updates ──────
  const existingSettings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});
  const updatedSettings: Record<string, unknown> = { ...existingSettings };

  if (body.venue !== undefined) {
    if (body.venue === null) { delete updatedSettings["venue"]; }
    else { updatedSettings["venue"] = body.venue; }
  }
  if (body.virtualUrl !== undefined) {
    if (body.virtualUrl === null) { delete updatedSettings["virtualUrl"]; }
    else { updatedSettings["virtualUrl"] = body.virtualUrl; }
  }
  if (body.heroImageUrl !== undefined) {
    if (body.heroImageUrl === null) { delete updatedSettings["heroImageUrl"]; }
    else { updatedSettings["heroImageUrl"] = body.heroImageUrl; }
  }
  if (body.location !== undefined) {
    if (body.location === null) { delete updatedSettings["location"]; }
    else { updatedSettings["location"] = body.location; }
  }
  if (body.sessionTypes !== undefined) {
    const proposal = (updatedSettings["proposal"] as Record<string, unknown> | undefined) ?? {};
    if (body.sessionTypes === null || body.sessionTypes.length === 0) {
      delete proposal["sessionTypes"];
      if (Object.keys(proposal).length === 0) { delete updatedSettings["proposal"]; }
      else { updatedSettings["proposal"] = proposal; }
    } else {
      updatedSettings["proposal"] = { ...proposal, sessionTypes: body.sessionTypes };
    }
  }
  if (body.settings) {
    Object.assign(updatedSettings, body.settings);
  }

  // ── Core event fields — use COALESCE so omitted fields are preserved ──────
  // starts_at / ends_at accept an explicit null to clear.
  await run(
    context.env.DB,
    `UPDATE events
     SET name                  = COALESCE(?, name),
         timezone              = COALESCE(?, timezone),
         starts_at             = IIF(? = 1, starts_at, ?),
         ends_at               = IIF(? = 1, ends_at,   ?),
         registration_mode     = COALESCE(?, registration_mode),
         invite_limit_attendee = COALESCE(?, invite_limit_attendee),
         settings_json         = ?,
         updated_at            = ?
     WHERE id = ?`,
    [
      body.name ?? null,
      body.timezone ?? null,
      // starts_at sentinel: 1 = omitted (keep existing), 0 = explicit value
      body.startsAt === undefined ? 1 : 0, body.startsAt ?? null,
      body.endsAt   === undefined ? 1 : 0, body.endsAt   ?? null,
      body.registrationMode ?? null,
      body.inviteLimitAttendee ?? null,
      stringifyJson(updatedSettings),
      nowIso(),
      event.id,
    ],
  );

  if (body.userRetentionDays) {
    await run(
      context.env.DB,
      `INSERT INTO retention_policies (event_id, user_retention_days, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(event_id)
       DO UPDATE SET user_retention_days = excluded.user_retention_days, updated_at = excluded.updated_at`,
      [event.id, body.userRetentionDays, nowIso()],
    );
  }

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "event_settings_updated",
    "event",
    event.id,
    body,
  );

  const updated = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const retention = await first<{ user_retention_days: number }>(
    context.env.DB,
    "SELECT user_retention_days FROM retention_policies WHERE event_id = ?",
    [event.id],
  );

  return json({
    success: true,
    event: {
      ...updated,
      user_retention_days: retention?.user_retention_days ?? null,
      settings: parseJsonSafe<Record<string, unknown>>(updated.settings_json, {}),
    },
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "PATCH") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPatch(context);
}
