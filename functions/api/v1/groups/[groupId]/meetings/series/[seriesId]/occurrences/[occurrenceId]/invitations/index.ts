import {
  eventOccurrenceInvitationsResponseSchema,
  eventOccurrenceInvitationsSendRouteSchema,
} from "../../../../../../../../../../../assets/shared/schemas/event-series";
import {
  eventOccurrenceInvitationsListResponseSchema,
  eventOccurrenceInvitationsListRouteSchema,
} from "../../../../../../../../../../../assets/shared/schemas/meeting-invitations";
import { requireAdminFromRequest } from "../../../../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../../../_lib/db/context";
import { processPendingOutboxBackground } from "../../../../../../../../../../_lib/email/outbox";
import { json } from "../../../../../../../../../../_lib/http";
import { buildPageInfo } from "../../../../../../../../../../../assets/shared/schemas/pagination";
import { openApiRoute } from "../../../../../../../../../../_lib/openapi/route";
import {
  listOccurrenceInvitations,
  sendMeetingParticipantInvitations,
} from "../../../../../../../../../../_lib/services/event-series";

export const GroupMeetingParticipantInvitationsList = openApiRoute(
  eventOccurrenceInvitationsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const { invitations, total } = await listOccurrenceInvitations(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      data.query,
    );
    return json(
      eventOccurrenceInvitationsListResponseSchema.parse({
        invitations,
        page: buildPageInfo(data.query.limit, data.query.offset, total, invitations.length),
      }),
    );
  },
);

export const GroupMeetingParticipantInvitationsSend = openApiRoute(
  eventOccurrenceInvitationsSendRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const invitations = await sendMeetingParticipantInvitations(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      resolveAppBaseUrl(c.env, c.req.raw),
      { signingSecret: c.env.INTERNAL_SIGNING_SECRET, rsvpEmail: c.env.RSVP_EMAIL },
    );
    /*
     * A round is a mailing, not a message: draining the pending outbox once
     * starts it moving without opening one background task per recipient,
     * and the scheduled drain carries whatever this pass does not reach.
     */
    c.executionCtx.waitUntil(processPendingOutboxBackground(db, c.env, invitations.recipientCount));
    return json(eventOccurrenceInvitationsResponseSchema.parse({ invitations }));
  },
);
