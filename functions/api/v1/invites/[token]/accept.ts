import { parseJsonBody } from "../../../../_lib/validation";
import { json, markSensitive } from "../../../../_lib/http";
import { findInviteByToken, acceptInvite } from "../../../../_lib/services/invites";
import { getRequiredTerms } from "../../../../_lib/services/events";
import { first } from "../../../../_lib/db/queries";
import { findOrCreateUser } from "../../../../_lib/services/users";
import { createRegistration } from "../../../../_lib/services/registrations";
import { persistConsents, validateRequiredConsents } from "../../../../_lib/services/consent";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { createReferralCode } from "../../../../_lib/services/referrals";
import { trySeedGravatarThenPrerender } from "../../../../_lib/services/og-badge-prerender";
import { proposalPageUrl } from "../../../../_lib/services/frontend-links";
import { deriveEventAttendanceType } from "../../../../_lib/services/event-days";
import type { PagesContext } from "../../../../_lib/types";
import { inviteAcceptAttendeeSchema } from "../../../../../assets/shared/schemas/api";
import { requireInternalSecret } from "../../../../_lib/request";

export async function onRequestPost(context: PagesContext<{ token: string }>): Promise<Response> {
  const config = getConfig(context.env, context.request);
  const signingSecret = requireInternalSecret(context.env);
  const appBaseUrl = resolveAppBaseUrl(context.env);
  const invite = await findInviteByToken(context.env.DB, context.params.token);
  const event = await first<{ id: string; slug: string; base_path: string | null; starts_at: string | null; name: string; settings_json: string }>(
    context.env.DB,
    "SELECT id, slug, base_path, starts_at, name, settings_json FROM events WHERE id = ?",
    [invite.event_id],
  );

  if (!event) {
    return json({ error: { code: "EVENT_NOT_FOUND", message: "Invite event not found" } }, 404);
  }

  if (invite.invite_type === "speaker") {
    await acceptInvite(context.env.DB, invite.id);
    return json({
      success: true,
      inviteType: "speaker",
      next: proposalPageUrl(appBaseUrl, event, { source: "speaker_invite_accept" }),
    });
  }

  const body = await parseJsonBody(context.request, inviteAcceptAttendeeSchema);

  if (invite.invitee_email !== body.email) {
    return json({ error: { code: "EMAIL_MISMATCH", message: "Invite email must match registration email" } }, 400);
  }

  const user = await findOrCreateUser(context.env.DB, {
    email: body.email,
    firstName: body.firstName,
    lastName: body.lastName,
    organizationName: body.organizationName,
    jobTitle: body.jobTitle,
  });

  const requiredTerms = await getRequiredTerms(context.env.DB, event.id, "attendee");
  await validateRequiredConsents(requiredTerms, body.consents);
  const customAnswers = await validateCustomAnswersByPurpose(context.env.DB, {
    eventId: event.id,
    purpose: "event_registration",
    customAnswers: body.customAnswers,
  });

  const created = await createRegistration(context.env.DB, {
    event: {
      id: event.id,
    },
    userId: user.id,
    attendanceType: (body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance)) as "in_person" | "virtual" | "on_demand",
    dayAttendance: body.dayAttendance,
    sourceType: "invite",
    customAnswersJson: Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null,
    inviteId: invite.id,
    confirmationTtlHours: config.manageTokenTtlHours,
  });

  await acceptInvite(context.env.DB, invite.id);
  await persistConsents(context.env.DB, {
    registrationId: created.registration.id,
    eventId: event.id,
    userId: user.id,
    audienceType: "attendee",
    accepted: body.consents,
    ip: context.request.headers.get("cf-connecting-ip"),
    userAgent: context.request.headers.get("user-agent"),
    secret: signingSecret,
  });

  const referralCode = await createReferralCode(context.env.DB, {
    eventId: event.id,
    ownerType: "registration",
    ownerId: created.registration.id,
    createdByUserId: user.id,
    length: config.referralCodeLength,
  });

  context.waitUntil(trySeedGravatarThenPrerender(user.id, user.email, referralCode, context.env, appBaseUrl));

  return json({
    success: true,
    registrationId: created.registration.id,
    status: created.registration.status,
    manageToken: created.manageToken,
    shareUrl: `${appBaseUrl}/r/${referralCode}`,
  });
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
