import { parseJsonBody } from "../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../_lib/http";
import { findInviteByToken, acceptInvite } from "../../../../_lib/services/invites";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { commitRegistrationSubmission } from "../../../../_lib/services/registration-submission";
import { prepareValidatedAttendeeRegistration } from "../../../../_lib/services/attendee-registration";
import { trySeedGravatarThenPrerender } from "../../../../_lib/services/og-badge-prerender";
import { proposalPageUrl } from "../../../../_lib/services/frontend-links";
import { inviteAcceptAttendeeSchema } from "../../../../../assets/shared/schemas/registration";
import { inviteAcceptRouteSchema, inviteCapabilityQuerySchema } from "../../../../../assets/shared/schemas/invites";
import { requireInternalSecret } from "../../../../_lib/request";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import type { z } from "zod";
import { getEventById } from "../../../../_lib/services/events";
import { requestDb } from "../../../../_lib/db/context";

type InviteAcceptAttendee = z.infer<typeof inviteAcceptAttendeeSchema>;

async function acceptInviteRequest(
  c: AdminContext,
  token: string,
  inviteId: string | undefined,
  attendeeBody: () => Promise<InviteAcceptAttendee>,
): Promise<Response> {
  c.set?.("sensitive", true);
  const config = getConfig(c.env, c.req.raw);
  const signingSecret = requireInternalSecret(c.env);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const db = requestDb(c);
  const invite = await findInviteByToken(db, token, signingSecret, inviteId ?? null);
  const event = await getEventById(db, invite.event_id);

  if (invite.invite_type === "speaker") {
    await acceptInvite(db, invite.id);
    return json({
      success: true,
      inviteType: "speaker",
      next: proposalPageUrl(appBaseUrl, event, { source: "speaker_invite_accept" }),
    });
  }

  const body = await attendeeBody();

  if (invite.invitee_email !== body.email) {
    return json({ error: { code: "EMAIL_MISMATCH", message: "Invite email must match registration email" } }, 400);
  }

  const { prepared } = await prepareValidatedAttendeeRegistration(db, body, {
    eventId: event.id,
    sourceType: "invite",
    invite,
    ip: c.req.raw.headers.get("cf-connecting-ip"),
    userAgent: c.req.raw.headers.get("user-agent"),
    pendingConfirmationDeadlineHours:
      (config.maxPendingConfirmationReminders + 1) * config.pendingConfirmationReminderIntervalDays * 24,
    signingSecret,
    confirmationTtlHours: config.confirmationLinkTtlHours,
    referralCodeLength: config.referralCodeLength,
  });
  await commitRegistrationSubmission(db, prepared);
  c.executionCtx.waitUntil(
    trySeedGravatarThenPrerender(prepared.user.id, prepared.user.email, prepared.referralCode, c.env, appBaseUrl),
  );

  return json({
    success: true,
    registrationId: prepared.registration.id,
    status: prepared.registration.status,
    manageToken: prepared.manageToken,
    shareUrl: `${appBaseUrl}/r/${prepared.referralCode}`,
  });
}

export const InviteAcceptPost = openApiRoute(inviteAcceptRouteSchema, (c: AdminContext, data) =>
  acceptInviteRequest(c, data.params.token, data.query.id, async () => {
    if (!data.body) throw new AppError(400, "INVALID_BODY", "Attendee registration details are required");
    return data.body;
  }),
);

/** Compatibility export for direct endpoint tests. */
export async function onRequestPost(c: AdminContext): Promise<Response> {
  const query = inviteCapabilityQuerySchema.parse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  return acceptInviteRequest(c, c.req.param("token"), query.id, () => parseJsonBody(c.req, inviteAcceptAttendeeSchema));
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchPostOnly(c, onRequestPost);
}
