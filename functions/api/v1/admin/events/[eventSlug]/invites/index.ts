import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { all } from "../../../../../../_lib/db/queries";
import type { PagesContext } from "../../../../../../_lib/types";

/**
 * GET /api/v1/admin/events/:eventSlug/invites
 *
 * Returns all invites for an event, with optional status filter.
 * Query params:
 *   ?status=sent|accepted|declined|expired|revoked   (omit for all)
 *   ?type=attendee|speaker                            (omit for all)
 */
export async function onRequestGet(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const url = new URL(context.request.url);
  const statusFilter = url.searchParams.get("status");
  const typeFilter = url.searchParams.get("type");

  const validStatuses = new Set(["sent", "accepted", "declined", "expired", "revoked"]);
  const validTypes = new Set(["attendee", "speaker"]);

  const conditions: string[] = ["i.event_id = ?"];
  const bindings: unknown[] = [event.id];

  if (statusFilter && validStatuses.has(statusFilter)) {
    conditions.push("i.status = ?");
    bindings.push(statusFilter);
  }

  if (typeFilter && validTypes.has(typeFilter)) {
    conditions.push("i.invite_type = ?");
    bindings.push(typeFilter);
  }

  const invites = await all(
    context.env.DB,
    `SELECT
       i.id,
       i.invitee_email,
       i.invitee_first_name,
       i.invitee_last_name,
       i.invite_type,
       i.status,
       i.decline_reason_code,
       i.decline_reason_note,
       i.unsubscribe_future,
       i.reminder_count,
       i.source_type,
       i.expires_at,
       i.accepted_at,
       i.declined_at,
       i.created_at,
       i.inviter_user_id,
       u.email      AS inviter_email,
       u.first_name AS inviter_first_name,
       u.last_name  AS inviter_last_name
     FROM invites i
     LEFT JOIN users u ON u.id = i.inviter_user_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY i.created_at DESC`,
    bindings,
  );

  return json({ invites });
}

export async function onRequest(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
