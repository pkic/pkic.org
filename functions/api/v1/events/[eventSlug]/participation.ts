import {
  sessionParticipationRouteSchema,
  sessionReviewRouteSchema,
  sessionBookingsRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-session-participation";
import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventBySlug } from "../../../../_lib/services/events";
import { setSessionParticipation } from "../../../../_lib/services/event-participation/session-booking";
import { participantSessionDatabase } from "../../../../_lib/services/event-participation/self-authorization";
import { personalAgendaRouteSchema } from "../../../../../assets/shared/schemas/event-personal-agenda";
import { personalAgenda } from "../../../../_lib/services/event-participation/personal-agenda";
import { requireEventPermission } from "./authorization";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { reviewSessionParticipation } from "../../../../_lib/services/event-participation/approval";
import { sessionBookings } from "../../../../_lib/services/event-participation/reporting";
export const SessionBookingsGet = openApiRoute(sessionBookingsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:write");
  return json(await sessionBookings(db, event.id, data.params.occurrenceId, data.query));
});
export const SessionParticipationReviewPut = openApiRoute(sessionReviewRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor, context } = await requireEventPermission(c, data.params.eventSlug, "agenda:write");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "agenda:write", context }],
    () => new AppError(403, "SESSION_APPROVAL_PERMISSION_CHANGED", "Your agenda permission changed."),
  );
  return json(
    await reviewSessionParticipation(
      guarded,
      event.id,
      data.params.occurrenceId,
      data.params.userId,
      data.body.decision,
    ),
  );
});
export const PersonalAgendaGet = openApiRoute(personalAgendaRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(
    await personalAgenda(
      participantSessionDatabase(db, actor.userId, actor.sessionId),
      event.id,
      actor.userId,
      data.query,
    ),
  );
});
export const SessionParticipationPut = openApiRoute(sessionParticipationRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(
    await setSessionParticipation(
      participantSessionDatabase(db, actor.userId, actor.sessionId),
      event.id,
      data.params.occurrenceId,
      actor.userId,
      data.body,
    ),
  );
});
