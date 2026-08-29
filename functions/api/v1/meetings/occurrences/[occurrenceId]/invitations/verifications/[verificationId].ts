import {
  meetingInvitationVerificationUpdateResponseSchema,
  meetingInvitationVerificationUpdateRouteSchema,
} from "../../../../../../../../assets/shared/schemas/event-series";
import {
  deriveMeetingGuestAuthorizationHash,
  issueMeetingGuestSession,
} from "../../../../../../../_lib/auth/meeting-guest-challenge";
import {
  getMeetingGuestChallengeCookieSecret,
  serializeExpiredMeetingGuestChallengeCookie,
  serializeMeetingGuestSessionCookie,
  signMeetingGuestSessionToken,
} from "../../../../../../../_lib/auth/meeting-guest-session";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { AppError } from "../../../../../../../_lib/errors";
import { jsonPrivate } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { enforceRateLimit } from "../../../../../../../_lib/rate-limit";
import { getClientIp, requireInternalSecret } from "../../../../../../../_lib/request";

const GUEST_SESSION_TTL_HOURS = 72;
const UPDATE_RATE_LIMIT_NAMESPACE = "meeting-invitation-verification-update:ip";

export const MeetingInvitationVerificationUpdate = openApiRoute(
  meetingInvitationVerificationUpdateRouteSchema,
  async (c: AdminContext, data) => {
    await enforceRateLimit({
      binding: c.env.IP_RATE_LIMITER,
      namespace: UPDATE_RATE_LIMIT_NAMESPACE,
      key: getClientIp(c.req.raw),
    });
    const browserSecret = getMeetingGuestChallengeCookieSecret(c.req.raw);
    if (!browserSecret) {
      throw new AppError(401, "MEETING_GUEST_CHALLENGE_INVALID", "Meeting guest verification is invalid or expired");
    }
    const authorizationHash = await deriveMeetingGuestAuthorizationHash({
      challengeId: data.params.verificationId,
      browserSecret,
      verificationCode: data.body.code,
    });
    const session = await issueMeetingGuestSession(requestDb(c), {
      challengeId: data.params.verificationId,
      occurrenceId: data.params.occurrenceId,
      authorizationHash,
      sessionTtlHours: GUEST_SESSION_TTL_HOURS,
    });
    const token = await signMeetingGuestSessionToken(requireInternalSecret(c.env), {
      guestId: session.guest.guestId,
      sessionId: session.sessionId,
      authorizationHash: session.authorizationHash,
      expiresAt: session.expiresAt,
    });
    const response = jsonPrivate(
      meetingInvitationVerificationUpdateResponseSchema.parse({
        occurrenceId: session.occurrenceId,
        expiresAt: session.expiresAt,
      }),
    );
    response.headers.append(
      "set-cookie",
      serializeMeetingGuestSessionCookie(token, data.params.occurrenceId, c.req.raw),
    );
    response.headers.append(
      "set-cookie",
      serializeExpiredMeetingGuestChallengeCookie(data.params.occurrenceId, c.req.raw),
    );
    return response;
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
