/**
 * POST /api/v1/events/:eventSlug/registrations/resend-manage-link
 *
 * Rotates the registration's manage token and queues an email with a fresh
 * management link, sent to the address provided by the caller.
 *
 * The response is always { success: true } regardless of whether the email
 * matched a registration — this prevents enumeration of registered attendees.
 */
import { z } from "zod";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { getEventBySlug, buildEventEmailVariables } from "../../../../../_lib/services/events";
import { first, run } from "../../../../../_lib/db/queries";
import { randomToken, sha256Hex } from "../../../../../_lib/utils/crypto";
import { nowIso } from "../../../../../_lib/utils/time";
import { getClientIp } from "../../../../../_lib/request";
import { enforceRateLimit } from "../../../../../_lib/rate-limit";
import { processOutboxByIdBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { registrationManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { normalizedEmailSchema } from "../../../../../../assets/shared/schemas/api";

const schema = z.object({
  email: normalizedEmailSchema,
});

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);

  const body = await parseJsonBody(c.req, schema);
  await enforceRateLimit({
    binding: c.env.EMAIL_RATE_LIMITER,
    namespace: "registration-resend-manage-link:email",
    key: body.email,
  });
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "registration-resend-manage-link:ip",
    key: getClientIp(c.req.raw),
  });

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));

  // Look up the user + any registration that can still be managed for this event by email.
  // Silently no-op when not found to prevent enumeration.
  const row = await first<{
    reg_id: string;
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    reg_status: string;
  }>(
    c.env.DB,
    `SELECT r.id AS reg_id, r.user_id, u.first_name, u.last_name, r.status AS reg_status
     FROM   registrations r
     JOIN   users u ON u.id = r.user_id
     WHERE  lower(u.email) = lower(?)
       AND  r.event_id = ?
      AND  r.status != 'cancelled_unauthorized'
     ORDER  BY r.created_at DESC
     LIMIT  1`,
    [body.email, event.id],
  );

  if (row) {
    const now = nowIso();
    const newToken = randomToken(24);
    const newHash = await sha256Hex(newToken);

    await run(c.env.DB, `UPDATE registrations SET manage_token_hash = ?, updated_at = ? WHERE id = ?`, [
      newHash,
      now,
      row.reg_id,
    ]);

    const manageUrl = registrationManagePageUrl(appBaseUrl, event, newToken);

    const outboxId = await queueEmail(c.env.DB, {
      eventId: event.id,
      templateKey: "registration_manage_link",
      recipientEmail: body.email,
      recipientUserId: row.user_id,
      messageType: "transactional",
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: row.first_name ?? "",
        lastName: row.last_name ?? "",
        email: body.email,
        manageUrl,
        status: row.reg_status,
      },
    });

    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
  }

  return json({ success: true });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
