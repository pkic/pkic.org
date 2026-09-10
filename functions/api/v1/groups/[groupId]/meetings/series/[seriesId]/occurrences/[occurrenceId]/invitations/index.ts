import {
  eventOccurrenceInvitationsResponseSchema,
  eventOccurrenceInvitationsSendRouteSchema,
} from "../../../../../../../../../../../assets/shared/schemas/event-series";
import { requireAdminFromRequest } from "../../../../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../../../_lib/db/context";
import { processPendingOutboxBackground } from "../../../../../../../../../../_lib/email/outbox";
import { json } from "../../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../../_lib/openapi/route";
import { sendMeetingParticipantInvitations } from "../../../../../../../../../../_lib/services/event-series";

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
