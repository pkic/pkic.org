import { groupEventProposalsListRouteSchema } from "../../../../../../../../assets/shared/schemas/group-event-proposals";
import { eventProposalsResponseSchema } from "../../../../../../../../assets/shared/schemas/event-proposals";
import { requireUserBackedAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../../../_lib/auth/proposal-access";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { listEventProposals } from "../../../../../../../_lib/services/event-proposals-list";
import { getEventById } from "../../../../../../../_lib/services/events";
import { requireGroupEventProposalContext } from "../../../../../../../_lib/services/proposal-group-context";

export const GroupEventProposalsList = openApiRoute(
  groupEventProposalsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const context = await requireGroupEventProposalContext(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      "proposals:read",
    );
    const [event, access] = await Promise.all([
      getEventById(db, context.eventId),
      getProposalAccessForEvent(db, context.eventId, actor),
    ]);
    const result = await listEventProposals(db, {
      ...data.query,
      eventId: context.eventId,
      searchPrivateFields: access.canReview,
    });
    return json(
      eventProposalsResponseSchema.parse({
        event: { id: event.id, slug: event.slug, name: event.name },
        access,
        ...result,
      }),
    );
  },
);
