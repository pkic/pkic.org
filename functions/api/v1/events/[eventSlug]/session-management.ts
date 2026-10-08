import { addManagedSessionParticipation } from "../../../../_lib/services/event-participation/session-booking";
import { sessionManagementInfoRouteSchema } from "../../../../../assets/shared/schemas/event-session-management";
import { sessionManagementInfo } from "../../../../_lib/services/event-participation/management-info";
import {
  sessionInvitationRouteSchema,
  sessionDelegationRouteSchema,
  sessionInviteesRouteSchema,
  managedSessionsRouteSchema,
} from "../../../../../assets/shared/schemas/event-session-management";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { requireSessionParticipantManager } from "../../../../_lib/services/event-participation/management-authorization";
import { setSessionInvitation, setSessionDelegation } from "../../../../_lib/services/event-participation/invitations";
import { badgeAttendees } from "../../../../_lib/services/event-participation/badge-attendees";
import { AppError } from "../../../../_lib/errors";
import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { getEventBySlug } from "../../../../_lib/services/events";
import { managedSessions } from "../../../../_lib/services/event-participation/managed-sessions";
export const SessionInvitationPut = openApiRoute(sessionInvitationRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireSessionParticipantManager(
    c,
    data.params.eventSlug,
    data.params.occurrenceId,
  );
  if (data.body.action === "add") {
    await addManagedSessionParticipation(
      db,
      event.id,
      data.params.occurrenceId,
      data.body.userId,
      { action: "reserve", attendanceMode: data.body.attendanceMode, roomId: data.body.roomId },
      { actorId: actor.id, reasonCode: data.body.reasonCode },
    );
    return json({ invited: false });
  }
  return json(
    await setSessionInvitation(
      db,
      event.id,
      data.params.occurrenceId,
      actor.id,
      data.body,
      c.env.INTERNAL_SIGNING_SECRET
        ? { secret: c.env.INTERNAL_SIGNING_SECRET, baseEmail: c.env.RSVP_EMAIL }
        : undefined,
    ),
  );
});
export const SessionDelegationPut = openApiRoute(sessionDelegationRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor, canDelegate } = await requireSessionParticipantManager(
    c,
    data.params.eventSlug,
    data.params.occurrenceId,
  );
  if (!canDelegate)
    throw new AppError(403, "DELEGATION_ORGANIZER_REQUIRED", "Only organizers can delegate session management.");
  return json(await setSessionDelegation(db, event.id, data.params.occurrenceId, actor.id, data.body));
});
export const SessionInviteesGet = openApiRoute(sessionInviteesRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireSessionParticipantManager(c, data.params.eventSlug, data.params.occurrenceId);
  return json(await badgeAttendees(db, event.id, data.query));
});
export const ManagedSessionsGet = openApiRoute(managedSessionsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c),
    actor = await requireIdentityFromRequest(db, c.req.raw, c.env),
    event = await getEventBySlug(db, data.params.eventSlug);
  return json(await managedSessions(db, event.id, actor.userId, data.query));
});

export const SessionManagementInfoGet = openApiRoute(
  sessionManagementInfoRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, canDelegate } = await requireSessionParticipantManager(
      c,
      data.params.eventSlug,
      data.params.occurrenceId,
    );
    return json(await sessionManagementInfo(db, data.params.occurrenceId, canDelegate));
  },
);
