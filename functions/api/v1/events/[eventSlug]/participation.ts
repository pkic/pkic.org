import { sessionVirtualRoomRouteSchema } from "../../../../../assets/shared/schemas/event-session-virtual-room";
import { readSessionVirtualRoom } from "../../../../_lib/services/event-participation/session-virtual-room";
import { requireSessionParticipantManager } from "../../../../_lib/services/event-participation/management-authorization";
import {
  sessionHoldRouteSchema,
  sessionHoldsGetRouteSchema,
  sessionHoldDeleteRouteSchema,
} from "../../../../../assets/shared/schemas/event-session-holds";
import {
  createSessionHold,
  listSessionHolds,
  revokeSessionHold,
} from "../../../../_lib/services/event-participation/holds";
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
import {
  personalAgendaProgramRouteSchema,
  personalAgendaRouteSchema,
} from "../../../../../assets/shared/schemas/event-personal-agenda";
import { personalAgenda, personalAgendaProgram } from "../../../../_lib/services/event-participation/personal-agenda";
import { getVisibleEventAudienceDetail } from "../../../../_lib/services/events/catalog";
import { AppError } from "../../../../_lib/errors";
import { reviewSessionParticipation } from "../../../../_lib/services/event-participation/approval";
import { sessionBookings } from "../../../../_lib/services/event-participation/reporting";
export const SessionBookingsGet = openApiRoute(sessionBookingsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireSessionParticipantManager(c, data.params.eventSlug, data.params.occurrenceId);
  return json(await sessionBookings(db, event.id, data.params.occurrenceId, data.query));
});
export const SessionParticipationReviewPut = openApiRoute(sessionReviewRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const {
    db: guarded,
    event,
    actor,
  } = await requireSessionParticipantManager(c, data.params.eventSlug, data.params.occurrenceId);
  return json(
    await reviewSessionParticipation(
      guarded,
      event.id,
      data.params.occurrenceId,
      data.params.userId,
      data.body.decision,
      actor.id,
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
/** Signed-in participants see the same approved projection as the public agenda, plus their own marks. */
export const PersonalAgendaProgramGet = openApiRoute(
  personalAgendaProgramRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const event = await getVisibleEventAudienceDetail(db, { userId: actor.userId }, data.params.eventSlug);
    return json(
      await personalAgendaProgram(
        participantSessionDatabase(db, actor.userId, actor.sessionId),
        { id: event.id, slug: data.params.eventSlug },
        actor.userId,
      ),
    );
  },
);
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

export const SessionHoldPost = openApiRoute(sessionHoldRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const {
    db: guarded,
    event,
    actor,
    canDelegate,
  } = await requireSessionParticipantManager(c, data.params.eventSlug, data.params.occurrenceId);
  if (!canDelegate) throw new AppError(403, "HOLD_ORGANIZER_REQUIRED", "Only organizers can allocate counted holds.");
  return json(await createSessionHold(guarded, event.id, data.params.occurrenceId, actor.id, data.body));
});

export const SessionHoldsGet = openApiRoute(sessionHoldsGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, canDelegate } = await requireSessionParticipantManager(
    c,
    data.params.eventSlug,
    data.params.occurrenceId,
  );
  if (!canDelegate) throw new AppError(403, "HOLD_ORGANIZER_REQUIRED", "Only organizers can manage counted holds.");
  return json(await listSessionHolds(db, event.id, data.params.occurrenceId));
});
export const SessionHoldDelete = openApiRoute(sessionHoldDeleteRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor, canDelegate } = await requireSessionParticipantManager(
    c,
    data.params.eventSlug,
    data.params.occurrenceId,
  );
  if (!canDelegate) throw new AppError(403, "HOLD_ORGANIZER_REQUIRED", "Only organizers can manage counted holds.");
  return json(await revokeSessionHold(db, event.id, data.params.occurrenceId, data.params.holdId, actor.id));
});

export const SessionVirtualRoomGet = openApiRoute(sessionVirtualRoomRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(await readSessionVirtualRoom(db, event.id, data.params.occurrenceId, actor));
});
