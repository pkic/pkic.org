import type { z } from "zod";
import {
  meetingJoinConfirmRouteSchema,
  meetingJoinConfirmSchema,
  meetingJoinLandingRouteSchema,
  meetingJoinResponseSchema,
} from "../../../assets/shared/schemas/event-series";
import { requestDb, type AdminContext } from "../../_lib/db/context";
import { AppError } from "../../_lib/errors";
import { jsonPrivate } from "../../_lib/http";
import { openApiRoute } from "../../_lib/openapi/route";
import { getClientIp, getUserAgent } from "../../_lib/request";
import { confirmMeetingJoin, getMeetingJoinLanding, type MeetingJoinSubject } from "../../_lib/services/event-series";

type MeetingJoinConfirmInput = z.infer<typeof meetingJoinConfirmSchema>;
type MeetingJoinSubjectResolver = (c: AdminContext, occurrenceId: string) => Promise<MeetingJoinSubject>;

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
