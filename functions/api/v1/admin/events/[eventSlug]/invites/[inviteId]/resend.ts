import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { resendInviteByAdmin } from "../../../../../../../_lib/services/invite-resend";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, c.req.param("eventSlug"));
  const result = await resendInviteByAdmin(db, {
    event,
    inviteId: c.req.param("inviteId"),
    admin,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
  return json({ success: true, inviteId: result.inviteId, resentAt: result.resentAt, inviteType: result.inviteType });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
