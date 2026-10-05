import {
  agendaCalendarSettingsGetRouteSchema,
  agendaCalendarSettingsPutRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-agenda-calendar";
import {
  agendaCalendarSettings,
  updateAgendaCalendarSettings,
} from "../../../../_lib/services/event-participation/calendar-subscriptions";
import {
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
  resolveAgendaCalendarSubscription,
  revokeAgendaCalendarSubscriptions,
  rotateAgendaCalendarSubscription,
} from "../../../../_lib/services/event-participation/calendar-subscriptions";
import { personalAgendaCalendar } from "../../../../_lib/services/event-participation/calendar-entries";
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
      new URL(c.req.raw.url).origin,
      data.params.eventSlug,
      data.body,
    ),
  );
});
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
  const event = await getEventBySlug(db, data.params.eventSlug);
  const subscription = await resolveAgendaCalendarSubscription(db, event.id, data.params.token);
  return new Response(
    await personalAgendaCalendar(
      db,
      event.id,
      subscription.user_id,
      subscription.include_tentative === 1,
      subscription.id,
    ),
    {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
});

export const AgendaCalendarSettingsGet = openApiRoute(
  agendaCalendarSettingsGetRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, data.params.eventSlug);
    return json(await agendaCalendarSettings(db, event.id, actor.userId));
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
