import {
  agendaCalendarSettingsGetRouteSchema,
  agendaCalendarSettingsPutRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-agenda-calendar";
import { updateAgendaCalendarSettings } from "../../../../_lib/services/event-participation/calendar-subscriptions";
import {
  agendaCalendarCurrentRouteSchema,
  agendaCalendarFeedRouteSchema,
  agendaCalendarRevokeRouteSchema,
  agendaCalendarRotateRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-agenda-calendar";
import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventBySlug } from "../../../../_lib/services/events";
import { participantSessionDatabase } from "../../../../_lib/services/event-participation/self-authorization";
import {
  revokeAgendaCalendarSubscriptions,
  rotateAgendaCalendarSubscription,
} from "../../../../_lib/services/event-participation/calendar-subscriptions";
import {
  readAgendaCalendarFeed,
  readAgendaCalendarSettings,
  readCurrentAgendaCalendarSubscription,
} from "../../../../_lib/services/event-participation/calendar-read";
function feedOrigin(c: AdminContext, eventSlug: string) {
  return { baseUrl: new URL(c.req.raw.url).origin, eventSlug, signingSecret: c.env.INTERNAL_SIGNING_SECRET };
}
export const AgendaCalendarRotatePost = openApiRoute(agendaCalendarRotateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(
    await rotateAgendaCalendarSubscription(
      participantSessionDatabase(db, actor.userId, actor.sessionId),
      event.id,
      actor.userId,
      feedOrigin(c, data.params.eventSlug),
      data.body,
    ),
  );
});
export const AgendaCalendarCurrentGet = openApiRoute(
  agendaCalendarCurrentRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    return json(
      await readCurrentAgendaCalendarSubscription(requestDb(c), c.req.raw, c.env, feedOrigin(c, data.params.eventSlug)),
    );
  },
);
export const AgendaCalendarRevokeDelete = openApiRoute(
  agendaCalendarRevokeRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, data.params.eventSlug);
    await revokeAgendaCalendarSubscriptions(
      participantSessionDatabase(db, actor.userId, actor.sessionId),
      event.id,
      actor.userId,
    );
    return json({ revoked: true });
  },
);
export const AgendaCalendarFeedGet = openApiRoute(agendaCalendarFeedRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  return new Response(await readAgendaCalendarFeed(db, data.params.eventSlug, data.params.token), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
});

export const AgendaCalendarSettingsGet = openApiRoute(
  agendaCalendarSettingsGetRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    return json(await readAgendaCalendarSettings(requestDb(c), c.req.raw, c.env, data.params.eventSlug));
  },
);
export const AgendaCalendarSettingsPut = openApiRoute(
  agendaCalendarSettingsPutRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, data.params.eventSlug);
    return json(
      await updateAgendaCalendarSettings(
        participantSessionDatabase(db, actor.userId, actor.sessionId),
        event.id,
        actor.userId,
        data.body,
      ),
    );
  },
);
