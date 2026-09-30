import { eventSpeakersListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-events";
import { eventSpeakersResponseSchema } from "../../../../../../assets/shared/schemas/event-speakers";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listEventProposalSpeakers } from "../../../../../_lib/services/event-proposal-speakers-list";
import { requireEventPermission } from "../authorization";

export const EventProposalSpeakersListGet = openApiRoute(
  eventSpeakersListRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "proposals:read");
    const result = await listEventProposalSpeakers(db, event.id, data.query);
    return json(eventSpeakersResponseSchema.parse(result));
  },
);
