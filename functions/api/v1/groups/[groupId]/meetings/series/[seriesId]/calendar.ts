import { eventSeriesCalendarRouteSchema } from "../../../../../../../../assets/shared/schemas/event-series";
import { requireMemberFromRequest } from "../../../../../../../_lib/auth/member";
import { AppError } from "../../../../../../../_lib/errors";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { generateGroupSeriesIcs } from "../../../../../../../_lib/services/event-series";
import { occurrenceOrganizerAddress } from "../../../../../../../_lib/services/event-series/occurrence-notifications";
import { requireGroupResourceContext } from "../../../../group-resource-context";

export const GroupMeetingSeriesCalendar = openApiRoute(
  eventSeriesCalendarRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    let personal: { userId: string; attendeeEmail: string; organizerEmail: string } | undefined;
    if (data.query.personal) {
      const member = await requireMemberFromRequest(db, c.req.raw, c.env);
      if (!c.env.INTERNAL_SIGNING_SECRET) {
        throw new AppError(503, "EMAIL_SIGNING_NOT_CONFIGURED", "Personal calendar RSVP signing is unavailable");
      }
      const organizerEmail = await occurrenceOrganizerAddress(data.params.seriesId, {
        signingSecret: c.env.INTERNAL_SIGNING_SECRET,
        rsvpEmail: c.env.RSVP_EMAIL,
      });
      if (!organizerEmail) {
        throw new AppError(503, "EMAIL_SIGNING_NOT_CONFIGURED", "Personal calendar RSVP signing is unavailable");
      }
      personal = { userId: member.userId, attendeeEmail: member.email, organizerEmail };
    }
    const calendar = await generateGroupSeriesIcs(
      db,
      viewer,
      group,
      data.params.seriesId,
      new URL(c.req.raw.url).origin,
      data.query.occurrenceId,
      personal,
    );
    return new Response(calendar.content, {
      headers: {
        "content-type": "text/calendar; charset=UTF-8",
        "content-disposition": `attachment; filename="${calendar.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  },
);
