import { adminEventInviteRevokeRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { revokeInviteByAdmin } from "../../../../../../../_lib/services/invites";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { successResponseSchema } from "../../../../../../../../assets/shared/schemas/api-common";

export const AdminEventsEventSlugInvitesInviteIdRevokePost = openApiRoute(
  adminEventInviteRevokeRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, data.params.eventSlug);
    await revokeInviteByAdmin(db, { event, inviteId: data.params.inviteId, admin });
    return json(successResponseSchema.parse({ success: true }));
  },
);
