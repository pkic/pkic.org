import { parseJsonBody } from "../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { resetFailedOutbox, processPendingOutbox } from "../../../../_lib/email/outbox";
import { adminResetFailedOutboxSchema } from "../../../../../assets/shared/schemas/admin-email-outbox";

/**
 * POST /api/v1/internal/email/reset-failed
 *
 * Explicitly resets `failed` or `delivery_unknown` outbox records back to
 * `retrying` (with attempts=0), then triggers processing. Unknown outcomes
 * are never replayed automatically because SendGrid may already have accepted
 * the original request.
 *
 * Body (all optional):
 *   { ids?: string[] }   — limit reset to specific outbox IDs; omit to reset all
 */
export async function onRequestPost(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminResetFailedOutboxSchema);

  const { reset } = await resetFailedOutbox(c.env.DB, body.ids);
  const send = await processPendingOutbox(c.env.DB, c.env, reset || 20);

  return json({ success: true, reset, ...send });
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
