import { deliverSeriesCalendar } from "../../../../../../../../../_lib/services/event-series/automatic-invitations";
import {
  eventOccurrenceResponseSchema,
  eventOccurrenceUpdateRouteSchema,
} from "../../../../../../../../../../assets/shared/schemas/event-series";
import { eventOccurrenceGetRouteSchema } from "../../../../../../../../../../assets/shared/schemas/meeting-invitations";
import { requireAdminFromRequest } from "../../../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import {
  getAccessibleSeriesOccurrence,
  updateSeriesOccurrence,
} from "../../../../../../../../../_lib/services/event-series";
import { requireGroupResourceContext } from "../../../../../../group-resource-context";

/** One occurrence, read the way the list reads it, so its own page opens what the row did. */
export const GroupMeetingOccurrenceGet = openApiRoute(eventOccurrenceGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const occurrence = await getAccessibleSeriesOccurrence(
    db,
    viewer,
    group.id,
    data.params.seriesId,
    data.params.occurrenceId,
  );
  return json(eventOccurrenceResponseSchema.parse({ occurrence }));
});

export const GroupMeetingOccurrenceUpdate = openApiRoute(
  eventOccurrenceUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const occurrence = await updateSeriesOccurrence(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      data.body,
      c.env.MEETING_PROVIDER_ENCRYPTION_KEY ?? "",
      // A meeting that moves or is called off reaches every calendar that
      // holds it (#126); the messages are queued with the change itself.
      {
        appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
        signingSecret: c.env.INTERNAL_SIGNING_SECRET,
        rsvpEmail: c.env.RSVP_EMAIL,
      },
    );
    c.executionCtx.waitUntil(deliverSeriesCalendar(db, c.env, c.req.raw, data.params.seriesId));
    return json(eventOccurrenceResponseSchema.parse({ occurrence }));
  },
);
