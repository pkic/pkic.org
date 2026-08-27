import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { json } from "../../../../../../../_lib/http";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { resendEventInvite } from "../../../../../../../_lib/services/invite-resend";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";
import { adminEventSpeakerInviteResendRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts-admin-events";
import { eventInviteResendResponseSchema } from "../../../../../../../../assets/shared/schemas/event-invites";

export const AdminEventsEventSlugInvitesInviteIdResendPost = openApiRoute(
  adminEventSpeakerInviteResendRouteSchema,
  async (c: AdminContext, validated: ValidatedData<typeof adminEventSpeakerInviteResendRouteSchema>) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, validated.params.eventSlug);
    const result = await resendEventInvite(db, {
      event,
      inviteId: validated.params.inviteId,
      actor: admin,
      expectedInviteType: "speaker",
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      expiresAt: validated.body.expiresAt,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    return json(eventInviteResendResponseSchema.parse({ success: true, ...result }));
  },
);
