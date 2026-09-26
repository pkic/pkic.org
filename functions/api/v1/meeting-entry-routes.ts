import type { z } from "zod";
import {
  meetingInvitationVerificationCreateResponseSchema,
  meetingJoinConfirmRouteSchema,
  meetingJoinConfirmSchema,
  meetingJoinLandingRouteSchema,
  meetingJoinResponseSchema,
} from "../../../assets/shared/schemas/meeting-entry";
import type { MeetingGuest } from "../../_lib/auth/meeting-guest-record";
import { serializeMeetingGuestChallengeCookie } from "../../_lib/auth/meeting-guest-session";
import { requestDb, type AdminContext } from "../../_lib/db/context";
import { processOutboxByIdBackground } from "../../_lib/email/outbox";
import { AppError } from "../../_lib/errors";
import { jsonPrivate } from "../../_lib/http";
import { openApiRoute } from "../../_lib/openapi/route";
import { enforceEmailTriggerRateLimits } from "../../_lib/rate-limit";
import { getClientIp, getUserAgent } from "../../_lib/request";
import { confirmMeetingJoin, getMeetingJoinLanding, type MeetingJoinSubject } from "../../_lib/services/event-series";
import { startMeetingGuestVerification } from "../../_lib/services/event-series/guest-verification";

type MeetingJoinConfirmInput = z.infer<typeof meetingJoinConfirmSchema>;
type MeetingJoinSubjectResolver = (c: AdminContext, occurrenceId: string) => Promise<MeetingJoinSubject>;

/** Both guest invitation forms use the same challenge, email, and browser-binding response. */
export async function createMeetingGuestChallengeResponse(
  c: AdminContext,
  guest: MeetingGuest,
  occurrenceId: string,
  rateLimitNamespace: string,
): Promise<Response> {
  const db = requestDb(c);
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: rateLimitNamespace,
    email: guest.normalizedEmail,
    clientIp: getClientIp(c.req.raw),
  });
  const started = await startMeetingGuestVerification(db, guest, occurrenceId);
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
    serializeMeetingGuestChallengeCookie(started.challenge.browserSecret, occurrenceId, c.req.raw),
  );
  return response;
}

function requireMeetingSecrets(c: AdminContext): { signing: string; encryption: string } {
  if (!c.env.INTERNAL_SIGNING_SECRET || !c.env.MEETING_PROVIDER_ENCRYPTION_KEY) {
    throw new AppError(503, "MEETING_SECURITY_CONFIG_UNAVAILABLE", "Meeting entry is not configured");
  }
  return { signing: c.env.INTERNAL_SIGNING_SECRET, encryption: c.env.MEETING_PROVIDER_ENCRYPTION_KEY };
}

async function landingResponse(c: AdminContext, occurrenceId: string, subject: MeetingJoinSubject) {
  const secrets = requireMeetingSecrets(c);
  return jsonPrivate(await getMeetingJoinLanding(requestDb(c), occurrenceId, subject, secrets.signing));
}

async function confirmationResponse(
  c: AdminContext,
  occurrenceId: string,
  subject: MeetingJoinSubject,
  input: MeetingJoinConfirmInput,
) {
  const secrets = requireMeetingSecrets(c);
  const result = await confirmMeetingJoin(requestDb(c), occurrenceId, subject, input, {
    encryptionSecret: secrets.encryption,
    revisionSecret: secrets.signing,
    evidenceSecret: secrets.signing,
    ip: getClientIp(c.req.raw),
    userAgent: getUserAgent(c.req.raw),
  });
  return jsonPrivate(meetingJoinResponseSchema.parse(result));
}

/** Shared authenticated HTTP adapter; persona routes supply only their session-bound subject resolver. */
export function createAuthenticatedMeetingJoinRoutes(resolveSubject: MeetingJoinSubjectResolver) {
  return {
    landing: openApiRoute(meetingJoinLandingRouteSchema, async (c: AdminContext, data) => {
      c.set?.("sensitive", true);
      const subject = await resolveSubject(c, data.params.occurrenceId);
      return landingResponse(c, data.params.occurrenceId, subject);
    }),
    confirmation: openApiRoute(meetingJoinConfirmRouteSchema, async (c: AdminContext, data) => {
      c.set?.("sensitive", true);
      const subject = await resolveSubject(c, data.params.occurrenceId);
      return confirmationResponse(c, data.params.occurrenceId, subject, data.body);
    }),
  };
}
