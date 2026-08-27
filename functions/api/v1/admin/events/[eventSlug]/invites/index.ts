import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { listAdminEventSpeakerInvites } from "../../../../../../_lib/services/events/admin-invite-list";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { adminEventSpeakerInvitesListRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-admin-events";

export const AdminEventInvitesList = openApiRoute(
  adminEventSpeakerInvitesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    await requireAdminFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, c.req.param("eventSlug"));
    return json(await listAdminEventSpeakerInvites(db, event.id, data.query));
  },
);
