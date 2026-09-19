import { fetchEventParticipation } from "../../../../_lib/services/events/participation";
import { eventDetailResponseSchema } from "../../../../../assets/shared/schemas/event-management";
import { eventDetailRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventDetail, getEventIdBySlug } from "../../../../_lib/services/events/detail";
import { getVisibleEventAudienceDetail } from "../../../../_lib/services/events/catalog";
import { eventAudienceViewer } from "../../../../_lib/services/events/visibility";
import { hasPermission } from "../../../../_lib/auth/permissions";
import { eventManagementCapabilities, resolveOptionalEventUserSession } from "./authorization";

export const EventDetailGet = openApiRoute(eventDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const session = await resolveOptionalEventUserSession(c);
  const eventId = session?.staff ? await getEventIdBySlug(db, data.params.eventSlug) : null;
  const context = eventId ? { type: "event", id: eventId } : null;
  const withParticipation = async <T extends { id: string }>(event: T) => ({
    ...event,
    participation: (await fetchEventParticipation(db, session?.identity.id ?? null, [event.id])).get(event.id),
  });
  if (session?.staff && context && hasPermission(session.staff, "events:read", context)) {
    return json(
      eventDetailResponseSchema.parse({
        event: await withParticipation(
          await getEventDetail(db, data.params.eventSlug, eventManagementCapabilities(session.staff, context)),
        ),
      }),
    );
  }
  return json(
    eventDetailResponseSchema.parse({
      event: await withParticipation(
        await getVisibleEventAudienceDetail(db, eventAudienceViewer(session), data.params.eventSlug),
      ),
    }),
  );
});
