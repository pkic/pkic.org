import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { resetFailedOutbox, processPendingOutbox } from "../../../../_lib/email/outbox";
import type { PagesContext } from "../../../../_lib/types";
import { adminResetFailedOutboxSchema } from "../../../../../assets/shared/schemas/api";

/**
 * POST /api/v1/internal/email/reset-failed
 *
 * Resets `failed` outbox records back to `retrying` status (with attempts=0)
 * so they are picked up by the next processPendingOutbox cycle, and then
 * immediately triggers that cycle so the emails are sent without further delay.
 *
 * Body (all optional):
 *   { ids?: string[] }   — limit reset to specific outbox IDs; omit to reset all
 */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminResetFailedOutboxSchema);

  const { reset } = await resetFailedOutbox(context.env.DB, body.ids);
  const send = await processPendingOutbox(context.env.DB, context.env, reset || 20);

  return json({ success: true, reset, ...send });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
