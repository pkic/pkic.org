import { deliverSeriesCalendar } from "../../../../../../../_lib/services/event-series/automatic-invitations";
import {
  eventSeriesCancelResponseSchema,
  eventSeriesCancelRouteSchema,
} from "../../../../../../../../assets/shared/schemas/meeting-invitations";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { cancelGroupEventSeries } from "../../../../../../../_lib/services/event-series";

/** Cancelling the meeting: its upcoming occurrences, their invitations, and the series itself (#126). */
export const GroupMeetingSeriesCancel = openApiRoute(eventSeriesCancelRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const result = await cancelGroupEventSeries(
    db,
    actor,
    data.params.groupId,
    data.params.seriesId,
    data.body.expectedUpdatedAt,
    {
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      signingSecret: c.env.INTERNAL_SIGNING_SECRET,
      rsvpEmail: c.env.RSVP_EMAIL,
    },
  );
  c.executionCtx.waitUntil(deliverSeriesCalendar(db, c.env, c.req.raw, data.params.seriesId));
  return json(eventSeriesCancelResponseSchema.parse(result));
});
