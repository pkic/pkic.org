import {
  meetingJoinConfirmRouteSchema,
  meetingJoinLandingRouteSchema,
  meetingJoinResponseSchema,
} from "../../../../../../assets/shared/schemas/event-series";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getClientIp, getUserAgent } from "../../../../../_lib/request";
import { confirmMeetingJoin, getMeetingJoinLanding } from "../../../../../_lib/services/event-series";

export const MeetingJoinLanding = openApiRoute(meetingJoinLandingRouteSchema, async (c: AdminContext, data) => {
  return json(await getMeetingJoinLanding(requestDb(c), data.params.token));
});

export const MeetingJoinConfirm = openApiRoute(meetingJoinConfirmRouteSchema, async (c: AdminContext, data) => {
  if (!c.env.MEETING_PROVIDER_ENCRYPTION_KEY || !c.env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(503, "MEETING_SECURITY_CONFIG_UNAVAILABLE", "Meeting entry is not configured");
  }
  const result = await confirmMeetingJoin(requestDb(c), data.params.token, data.body, {
    encryptionSecret: c.env.MEETING_PROVIDER_ENCRYPTION_KEY,
    evidenceSecret: c.env.INTERNAL_SIGNING_SECRET,
    ip: getClientIp(c.req.raw),
    userAgent: getUserAgent(c.req.raw),
  });
  return json(meetingJoinResponseSchema.parse(result));
});
