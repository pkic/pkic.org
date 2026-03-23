import { parseJsonBody } from "../../../../_lib/validation";
import { json, markSensitive } from "../../../../_lib/http";
import { buildEventEmailVariables, getEventBySlug } from "../../../../_lib/services/events";
import { getRegistrationByManageToken } from "../../../../_lib/services/registrations";
import { countInvitesByInviter, createInvite } from "../../../../_lib/services/invites";
import { createReferralCode } from "../../../../_lib/services/referrals";
import { first } from "../../../../_lib/db/queries";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { registrationPageUrl, inviteDeclineUrl } from "../../../../_lib/services/frontend-links";
import { AppError } from "../../../../_lib/errors";
import type { PagesContext } from "../../../../_lib/types";
import { registrationInviteCreateSchema } from "../../../../../assets/shared/schemas/api";

function getManageTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export async function onRequestPost(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  const token = getManageTokenFromRequest(context.request);
  if (!token) {
    return json({ error: { code: "AUTH_REQUIRED", message: "Registration manage token required" } }, 401);
  }

  const body = await parseJsonBody(context.request, registrationInviteCreateSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const registration = await getRegistrationByManageToken(context.env.DB, token);

  if (registration.event_id !== event.id) {
    return json({ error: { code: "EVENT_MISMATCH", message: "Token is not valid for this event" } }, 403);
  }

  const config = getConfig(context.env, context.request);
  const appBaseUrl = resolveAppBaseUrl(context.env);
  const maxAllowed = event.invite_limit_attendee ?? config.inviteLimitPerAttendee;

  // Look up inviter name once — used to personalise invite emails.
  const inviterUser = await first<{ first_name: string | null; last_name: string | null; organization_name: string | null }>(
    context.env.DB,
    "SELECT first_name, last_name, organization_name FROM users WHERE id = ?",
    [registration.user_id],
  );
  const inviterBaseName = inviterUser
    ? [inviterUser.first_name, inviterUser.last_name].filter(Boolean).join(" ")
    : "";
  const inviterName = inviterBaseName && inviterUser?.organization_name
    ? `${inviterBaseName} (${inviterUser.organization_name})`
    : inviterBaseName;

  let referralCode = await first<{ code: string }>(
    context.env.DB,
    "SELECT code FROM referral_codes WHERE owner_type = 'registration' AND owner_id = ? LIMIT 1",
    [registration.id],
  );

  if (!referralCode) {
    referralCode = {
      code: await createReferralCode(context.env.DB, {
        eventId: event.id,
        ownerType: "registration",
        ownerId: registration.id,
        createdByUserId: registration.user_id,
        length: config.referralCodeLength,
      }),
    };
  }

  // Count only primary (new) invites against the per-attendee quota.
  // Co-invites (endorsements of someone already invited) are free.
  let inviteCount = await countInvitesByInviter(context.env.DB, event.id, registration.user_id);

  if (inviteCount + body.invites.length > maxAllowed) {
    return json({
      error: {
        code: "INVITE_LIMIT_EXCEEDED",
        message: `Invite limit reached. You can send up to ${maxAllowed} invitations for this event.`,
      },
    }, 429);
  }

  const created: Array<{ email: string }> = [];
  // endorsed: invitee was already invited; this user's endorsement was recorded
  //           for social proof but no new email was sent.
  const endorsed: Array<{ email: string }> = [];
  // skipped: could not create invite (already registered, unsubscribed, etc.).
  const skipped: Array<{ email: string; reason: string }> = [];

  for (const item of body.invites) {
    // Enforce the per-attendee quota only for new (primary) invites.
    if (inviteCount + 1 > maxAllowed) {
      skipped.push({ email: item.email, reason: "invite_limit_exceeded" });
      continue;
    }

    try {
      const { invite, token: inviteToken, isNew } = await createInvite(context.env.DB, {
        eventId: event.id,
        inviterUserId: registration.user_id,
        inviterRegistrationId: registration.id,
        inviteeEmail: item.email,
        inviteeFirstName: item.firstName,
        inviteeLastName: item.lastName,
        inviteType: "attendee",
        sourceType: "peer-invite",
        ttlHours: 24 * 14,
      });

      if (isNew) {
        inviteCount++;
        const registrationUrl = registrationPageUrl(appBaseUrl, event, {
          invite: inviteToken,
          ref: referralCode.code,
          source: "invite",
        });
        const declineUrl = inviteDeclineUrl(appBaseUrl, event, inviteToken);
        const outboxId = await queueEmail(context.env.DB, {
          eventId: event.id,
          templateKey: "attendee_invite",
          recipientEmail: invite.invitee_email,
          messageType: "transactional",
          subject: `Invitation: ${event.name}`,
          data: {
            ...buildEventEmailVariables(event, appBaseUrl),
            firstName: invite.invitee_first_name ?? "",
            lastName: invite.invitee_last_name ?? "",
            inviterName,
            registrationUrl,
            declineUrl,
          },
        });
        context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
        created.push({ email: invite.invitee_email });
      } else {
        endorsed.push({ email: invite.invitee_email });
      }
    } catch (err) {
      if (err instanceof AppError && (
        err.code === "INVITEE_ALREADY_REGISTERED"
        || err.code === "INVITEE_ALREADY_PROPOSED"
        || err.code === "INVITEE_UNSUBSCRIBED"
      )) {
        skipped.push({ email: item.email, reason: err.code.toLowerCase() });
      } else {
        throw err;
      }
    }
  }

  return json({ success: true, created, endorsed, skipped, referralCode: referralCode.code });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}

