import {
  meetingGuestInvitationBootstrapResponseSchema,
  meetingGuestInvitationBootstrapRouteSchema,
} from "../../../../../assets/shared/schemas/event-series";
import { verifyMeetingGuestInvitationForBootstrap } from "../../../../_lib/auth/meeting-guest-challenge";
import { serializeMeetingGuestChallengeCookie } from "../../../../_lib/auth/meeting-guest-session";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { enforceEmailTriggerRateLimits } from "../../../../_lib/rate-limit";
import { getClientIp } from "../../../../_lib/request";
import { startMeetingGuestVerification } from "../../../../_lib/services/event-series";

const BOOTSTRAP_RATE_LIMIT_NAMESPACE = "meeting-guest-invitation-bootstrap";

export const MeetingGuestInvitationBootstrap = openApiRoute(
  meetingGuestInvitationBootstrapRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const guest = await verifyMeetingGuestInvitationForBootstrap(db, data.body.token, c.env);
    await enforceEmailTriggerRateLimits({
      emailBinding: c.env.EMAIL_RATE_LIMITER,
      ipBinding: c.env.IP_RATE_LIMITER,
      namespace: BOOTSTRAP_RATE_LIMIT_NAMESPACE,
      email: guest.normalizedEmail,
      clientIp: getClientIp(c.req.raw),
    });
    const started = await startMeetingGuestVerification(db, guest, data.body.occurrenceId);
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, started.outboxId));

    const response = jsonPrivate(
      meetingGuestInvitationBootstrapResponseSchema.parse({
        challengeId: started.challenge.challengeId,
        expiresAt: started.challenge.expiresAt,
      }),
      202,
    );
    response.headers.append(
      "set-cookie",
      serializeMeetingGuestChallengeCookie(started.challenge.browserSecret, c.req.raw),
    );
    return response;
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
