import { adminEventSpeakerInviteRevokeRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts-admin-events";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { revokeEventInvite } from "../../../../../../../_lib/services/invite-revoke";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { successResponseSchema } from "../../../../../../../../assets/shared/schemas/api-common";

export const AdminEventsEventSlugInvitesInviteIdRevokePost = openApiRoute(
  adminEventSpeakerInviteRevokeRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, data.params.eventSlug);
    await revokeEventInvite(db, {
      event,
      inviteId: data.params.inviteId,
      actor: admin,
      expectedInviteType: "speaker",
    });
    return json(successResponseSchema.parse({ success: true }));
  },
);
