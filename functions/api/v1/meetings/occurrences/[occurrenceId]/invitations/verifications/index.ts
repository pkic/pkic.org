import {
  meetingInvitationVerificationCreateResponseSchema,
  meetingInvitationVerificationCreateRouteSchema,
} from "../../../../../../../../assets/shared/schemas/meeting-entry";
import { verifyMeetingGuestInvitationForChallengeCreation } from "../../../../../../../_lib/auth/meeting-guest-challenge";
import { serializeMeetingGuestChallengeCookie } from "../../../../../../../_lib/auth/meeting-guest-session";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { jsonPrivate } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { enforceEmailTriggerRateLimits } from "../../../../../../../_lib/rate-limit";
import { getClientIp } from "../../../../../../../_lib/request";
import { startMeetingGuestVerification } from "../../../../../../../_lib/services/event-series";

const CREATE_RATE_LIMIT_NAMESPACE = "meeting-invitation-verification-create";

export const MeetingInvitationVerificationCreate = openApiRoute(
  meetingInvitationVerificationCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const guest = await verifyMeetingGuestInvitationForChallengeCreation(db, data.body.token, c.env);
    await enforceEmailTriggerRateLimits({
      emailBinding: c.env.EMAIL_RATE_LIMITER,
      ipBinding: c.env.IP_RATE_LIMITER,
      namespace: CREATE_RATE_LIMIT_NAMESPACE,
      email: guest.normalizedEmail,
      clientIp: getClientIp(c.req.raw),
    });
    const started = await startMeetingGuestVerification(db, guest, data.params.occurrenceId);
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, started.outboxId));

    const response = jsonPrivate(
      meetingInvitationVerificationCreateResponseSchema.parse({
        verificationId: started.challenge.challengeId,
        expiresAt: started.challenge.expiresAt,
      }),
      202,
    );
    response.headers.append(
      "set-cookie",
      serializeMeetingGuestChallengeCookie(started.challenge.browserSecret, data.params.occurrenceId, c.req.raw),
    );
    return response;
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
