import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { resendInviteByAdmin } from "../../../../../../../_lib/services/invite-resend";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";
import {
  adminInviteResendResponseSchema,
  adminInviteResendRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-admin-event-communications";

export async function onRequestPost(
  c: AdminContext,
  validated?: ValidatedData<typeof adminInviteResendRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const eventSlug = validated?.params.eventSlug ?? c.req.param("eventSlug");
  const inviteId = validated?.params.inviteId ?? c.req.param("inviteId");
  const event = await getEventBySlug(db, eventSlug);
  const result = await resendInviteByAdmin(db, {
    event,
    inviteId,
    admin,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
  return json(adminInviteResendResponseSchema.parse({ success: true, ...result }));
}

export const AdminEventsEventSlugInvitesInviteIdResendPost = openApiRoute(adminInviteResendRouteSchema, onRequestPost);

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
