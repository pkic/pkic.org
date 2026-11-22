import {
  eventInvitationDeclineRouteSchema,
  eventInvitationRemindersRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-invitation";
import { guardUserSessionRequestDatabase } from "../../../../_lib/auth/member";
import { resolveUserSessionContext } from "../../../../_lib/auth/user-session";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { prepareAuthorizationGuard } from "../../../../_lib/db/authorization-guard";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventBySlug } from "../../../../_lib/services/events";
import {
  findHeldAttendeeInvitation,
  heldAttendeeInvitationEvidence,
} from "../../../../_lib/services/held-event-invitation";
import { declineAndForwardResolvedInvite } from "../../../../_lib/services/invite-decline";
import { updateInviteReminderPreference } from "../../../../_lib/services/invite-reminder-preference";

/** The signed-in person's own open invitation, with live session and ownership rechecked in its write batch. */
async function heldInvitationContext(c: AdminContext, params: { eventSlug: string; inviteId: string }) {
  markResponseSensitive(c);
  const db = requestDb(c);
  const { claims, session } = await resolveUserSessionContext(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, params.eventSlug);
  const scope = { eventId: event.id, userId: session.identity.id, inviteId: params.inviteId };
  const invite = await findHeldAttendeeInvitation(db, scope);
  if (!invite) throw new AppError(404, "INVITE_NOT_FOUND", "No open invitation to this event for your account.");
  const guardedDb = guardUserSessionRequestDatabase(db, claims);
  return {
    db: guardedDb,
    invite,
    guards: [prepareAuthorizationGuard(guardedDb, heldAttendeeInvitationEvidence(scope))],
  };
}

export const EventInvitationDeclinePost = openApiRoute(
  eventInvitationDeclineRouteSchema,
  async (c: AdminContext, data) => {
    const { db, invite, guards } = await heldInvitationContext(c, data.params);
    const result = await declineAndForwardResolvedInvite(db, invite, {
      body: data.body,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      guards,
    });
    for (const outboxId of result.outboxIds)
      c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outboxId));
    return json({ success: true, forwarded: result.forwardedEmails });
  },
);

export const EventInvitationRemindersPost = openApiRoute(
  eventInvitationRemindersRouteSchema,
  async (c: AdminContext, data) => {
    const { db, invite, guards } = await heldInvitationContext(c, data.params);
    return json({ success: true, ...(await updateInviteReminderPreference(db, invite, data.body.action, guards)) });
  },
);
