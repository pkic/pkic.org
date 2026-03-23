/**
 * POST /api/v1/events/:eventSlug/registrations/resend-manage-link
 *
 * Rotates the registration's manage token and queues an email with a fresh
 * management link, sent to the address provided by the caller.
 *
 * The response is always { success: true } regardless of whether the email
 * matched a registration — this prevents enumeration of registered attendees.
 *
 * Rate limiting / abuse prevention is handled at the edge (Cloudflare WAF).
 */
import { z } from "zod";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json, markSensitive } from "../../../../../_lib/http";
import { getEventBySlug, buildEventEmailVariables } from "../../../../../_lib/services/events";
import { first, run } from "../../../../../_lib/db/queries";
import { randomToken, sha256Hex } from "../../../../../_lib/utils/crypto";
import { nowIso } from "../../../../../_lib/utils/time";
import { processOutboxByIdBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { registrationManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { normalizedEmailSchema } from "../../../../../../assets/shared/schemas/api";
import type { PagesContext } from "../../../../../_lib/types";

const schema = z.object({
  email: normalizedEmailSchema,
});

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  markSensitive(context);

  const body = await parseJsonBody(context.request, schema);
  const appBaseUrl = resolveAppBaseUrl(context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  // Look up the user + any active registration for this event by email.
  // Silently no-op when not found to prevent enumeration.
  const row = await first<{
    reg_id: string;
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    reg_status: string;
  }>(
    context.env.DB,
    `SELECT r.id AS reg_id, r.user_id, u.first_name, u.last_name, r.status AS reg_status
     FROM   registrations r
     JOIN   users u ON u.id = r.user_id
     WHERE  lower(u.email) = lower(?)
       AND  r.event_id = ?
       AND  r.status NOT IN ('cancelled', 'cancelled_unauthorized')
     ORDER  BY r.created_at DESC
     LIMIT  1`,
    [body.email, event.id],
  );

  if (row) {
    const now = nowIso();
    const newToken = randomToken(24);
    const newHash = await sha256Hex(newToken);

    await run(
      context.env.DB,
      `UPDATE registrations SET manage_token_hash = ?, updated_at = ? WHERE id = ?`,
      [newHash, now, row.reg_id],
    );

    const manageUrl = registrationManagePageUrl(appBaseUrl, event, newToken);

    const outboxId = await queueEmail(context.env.DB, {
      eventId: event.id,
      templateKey: "registration_updated",
      recipientEmail: body.email,
      recipientUserId: row.user_id,
      messageType: "transactional",
      subject: `Your management link for ${event.name}`,
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: row.first_name ?? "",
        lastName: row.last_name ?? "",
        email: body.email,
        manageUrl,
        status: row.reg_status,
      },
    });

    context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
  }

  return json({ success: true });
}

export async function onRequest(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  markSensitive(context);
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
