import { personalEventCalendarRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { resolveUserSessionFromRequest } from "../../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { personalEventCalendar } from "../../../../../../_lib/services/registrations/personal-calendar";

export const PersonalEventCalendarGet = openApiRoute(
  personalEventCalendarRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const session = await resolveUserSessionFromRequest(db, c.req.raw, {
      INTERNAL_SIGNING_SECRET: c.env.INTERNAL_SIGNING_SECRET,
    });
    const calendar = await personalEventCalendar(
      db,
      data.params.eventSlug,
      data.params.registrationId,
      session.identity.id,
      session.identity.email,
      new URL(c.req.raw.url).origin,
      c.env.INTERNAL_SIGNING_SECRET,
      c.env.RSVP_EMAIL,
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
