import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { json } from "../../../../../../../_lib/http";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { resendInviteByAdmin } from "../../../../../../../_lib/services/invite-resend";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";
import {
  adminInviteResendResponseSchema,
  adminInviteResendRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-admin-event-communications";

export const AdminEventsEventSlugInvitesInviteIdResendPost = openApiRoute(
  adminInviteResendRouteSchema,
  async (c: AdminContext, validated: ValidatedData<typeof adminInviteResendRouteSchema>) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    const eventSlug = validated.params.eventSlug;
    const inviteId = validated.params.inviteId;
    const event = await getEventBySlug(db, eventSlug);
    const result = await resendInviteByAdmin(db, {
      event,
      inviteId,
      admin,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    return json(adminInviteResendResponseSchema.parse({ success: true, ...result }));
  },
);
