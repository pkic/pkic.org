import { meetingInvitationVerificationCreateRouteSchema } from "../../../../../../../../assets/shared/schemas/meeting-entry";
import { verifyMeetingGuestInvitationForChallengeCreation } from "../../../../../../../_lib/auth/meeting-guest-challenge";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { createMeetingGuestChallengeResponse } from "../../../../../meeting-entry-routes";

const CREATE_RATE_LIMIT_NAMESPACE = "meeting-invitation-verification-create";

export const MeetingInvitationVerificationCreate = openApiRoute(
  meetingInvitationVerificationCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const guest = await verifyMeetingGuestInvitationForChallengeCreation(db, data.body.token, c.env);
    return createMeetingGuestChallengeResponse(c, guest, data.params.occurrenceId, CREATE_RATE_LIMIT_NAMESPACE);
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
