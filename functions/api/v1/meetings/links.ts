import {
  meetingPersonalLinkResolveResponseSchema,
  meetingPersonalLinkResolveRouteSchema,
  meetingPersonalLinkSessionResponseSchema,
  meetingPersonalLinkSessionRouteSchema,
  meetingPersonalLinkSessionDeleteRouteSchema,
  meetingPersonalLinkVerificationRouteSchema,
} from "../../../../assets/shared/schemas/meeting-entry";
import { establishMeetingEntryBrowser, revokeMeetingEntryBrowser } from "../../../_lib/auth/meeting-entry-browser";
import { findMeetingGuest, requireLiveMeetingGuest, toMeetingGuest } from "../../../_lib/auth/meeting-guest-record";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { AppError } from "../../../_lib/errors";
import { jsonPrivate, noContent } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  requirePersonalMeetingLink,
  requirePersonalMeetingTarget,
} from "../../../_lib/services/event-series/personal-entry-links";
import { createMeetingGuestChallengeResponse } from "../meeting-entry-routes";

function signingSecret(c: AdminContext): string {
  if (!c.env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(503, "MEETING_SECURITY_CONFIG_UNAVAILABLE", "Meeting entry is not configured");
  }
  return c.env.INTERNAL_SIGNING_SECRET;
}

export const MeetingPersonalLinkResolve = openApiRoute(
  meetingPersonalLinkResolveRouteSchema,
  async (c: AdminContext, data) => {
    const link = await requirePersonalMeetingLink(requestDb(c), data.body.token, signingSecret(c));
    const target = await requirePersonalMeetingTarget(requestDb(c), link);
    return jsonPrivate(meetingPersonalLinkResolveResponseSchema.parse(target));
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);

export const MeetingPersonalLinkSession = openApiRoute(
  meetingPersonalLinkSessionRouteSchema,
  async (c: AdminContext, data) => {
    const result = await establishMeetingEntryBrowser(
      requestDb(c),
      c.req.raw,
      data.body.token,
      data.params.occurrenceId,
      c.env,
    );
    const response = jsonPrivate(meetingPersonalLinkSessionResponseSchema.parse(result));
    if (result.cookie) response.headers.append("set-cookie", result.cookie);
    return response;
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);

export const MeetingPersonalLinkVerification = openApiRoute(
  meetingPersonalLinkVerificationRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const link = await requirePersonalMeetingLink(db, data.body.token, signingSecret(c));
    if (!link.guest_id) throw new AppError(404, "MEETING_LINK_INVALID", "This is not a guest invitation");
    await requirePersonalMeetingTarget(db, link, data.params.occurrenceId);
    const guest = toMeetingGuest(requireLiveMeetingGuest(await findMeetingGuest(db, link.guest_id)));
    return createMeetingGuestChallengeResponse(
      c,
      guest,
      data.params.occurrenceId,
      "meeting-personal-link-verification",
    );
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);

export const MeetingPersonalLinkSessionDelete = openApiRoute(
  meetingPersonalLinkSessionDeleteRouteSchema,
  async (c: AdminContext) => {
    const expired = revokeMeetingEntryBrowser(c.req.raw);
    const response = noContent();
    response.headers.append("set-cookie", expired);
    return response;
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
