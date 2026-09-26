import type { z } from "zod";
import type { registrationInviteCreateSchema } from "../../../assets/shared/schemas/registration";
import { getBearerToken } from "../auth/session-engine";
import { first } from "../db/queries";
import { AppError } from "../errors";
import { getConfig, resolveAppBaseUrl } from "../config";
import { requireInternalSecret } from "../request";
import { buildEventEmailVariables, getEventBySlug } from "./events";
import { getRegistrationByManageToken } from "./registrations";
import { bulkCreateInvites } from "./invite-bulk";
import { countInvitesByInviter } from "./invites";
import { createReferralCode } from "./referrals";
import { firstReferralCodeQuerySql } from "./referral-code-projection";
import { inviteDeclineUrl, proposalPageUrl, registrationPageUrl } from "./frontend-links";
import type { Env } from "../types";
import { emailPlainText } from "../email/plain-text";
import { buildEventInviteRecipientVariables } from "./event-invite-email-variables";

type PeerInviteBody = z.infer<typeof registrationInviteCreateSchema>;

export interface PeerInviteCreationResult {
  response: {
    success: true;
    created: Array<{ email: string }>;
    endorsed: Array<{ email: string }>;
    skipped: Array<{ email: string; reason: string }>;
    referralCode?: string;
  };
  outboxIds: string[];
}

function displayName(
  user: {
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
  } | null,
): string {
  if (!user) return "";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return name && user.organization_name ? `${name} (${user.organization_name})` : name;
}

async function registrationReferralCode(
  env: Env,
  eventId: string,
  registrationId: string,
  userId: string,
  length: number,
): Promise<string> {
  const existing = await first<{ code: string }>(env.DB, firstReferralCodeQuerySql("registration", "?"), [
    registrationId,
  ]);
  return (
    existing?.code ??
    (await createReferralCode(env.DB, {
      eventId,
      ownerType: "registration",
      ownerId: registrationId,
      createdByUserId: userId,
      length,
    }))
  );
}

/** Shared attendee-invite/speaker-nomination workflow and D1 bulk boundary. */
export async function createPeerInvitations(
  env: Env,
  request: Request,
  eventSlug: string,
  body: PeerInviteBody,
  inviteType: "attendee" | "speaker",
): Promise<PeerInviteCreationResult> {
  const manageToken = getBearerToken(request);
  if (!manageToken) throw new AppError(401, "AUTH_REQUIRED", "Registration manage token required");
  const event = await getEventBySlug(env.DB, eventSlug);
  const registration = await getRegistrationByManageToken(env.DB, manageToken, requireInternalSecret(env));
  if (registration.event_id !== event.id) {
    throw new AppError(403, "EVENT_MISMATCH", "Token is not valid for this event");
  }

  const config = getConfig(env, request);
  const maxAllowed =
    inviteType === "attendee"
      ? (event.invite_limit_attendee ?? config.inviteLimitPerAttendee)
      : (event.invite_limit_speaker_nomination ?? config.inviteLimitSpeakerNomination);
  const currentCount = await countInvitesByInviter(env.DB, event.id, registration.user_id, inviteType);
  if (currentCount + body.invites.length > maxAllowed) {
    throw new AppError(
      429,
      "INVITE_LIMIT_EXCEEDED",
      `Invite limit reached. You can send up to ${maxAllowed} invitations for this event.`,
    );
  }

  const user = await first<{
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
  }>(env.DB, "SELECT first_name, last_name, organization_name FROM users WHERE id = ?", [registration.user_id]);
  const inviterName = displayName(user);
  const appBaseUrl = resolveAppBaseUrl(env, request);
  const referralCode =
    inviteType === "attendee"
      ? await registrationReferralCode(env, event.id, registration.id, registration.user_id, config.referralCodeLength)
      : undefined;

  const outcomes = await bulkCreateInvites(env.DB, inviteType, {
    event,
    expiresAt: body.expiresAt,
    inviter: { userId: registration.user_id, registrationId: registration.id },
    maxPrimaryInvites: maxAllowed,
    invites: body.invites.map((invite) => ({
      inviteeEmail: invite.email,
      inviteeFirstName: invite.firstName,
      inviteeLastName: invite.lastName,
      sourceType: inviteType === "attendee" ? "peer-invite" : "peer-nomination",
    })),
    buildEmailRow: ({ inviteId, token, email, invite, linkSecretFingerprint }) => {
      const primaryUrl =
        inviteType === "attendee"
          ? registrationPageUrl(appBaseUrl, event, {
              invite: token,
              inviteId,
              ref: referralCode,
              source: "invite",
            })
          : proposalPageUrl(appBaseUrl, event, {
              invite: token,
              inviteId,
              source: "speaker_peer_nomination",
            });
      const declineUrl = inviteDeclineUrl(appBaseUrl, event, token, inviteId);
      const primaryKey = inviteType === "attendee" ? "registrationUrl" : "proposalUrl";
      return {
        eventId: event.id,
        templateKey: inviteType === "attendee" ? "attendee_invite" : "speaker_invite",
        recipientEmail: email,
        messageType: "transactional",
        subject: inviteType === "attendee" ? `Invitation: ${event.name}` : `Invitation to speak at ${event.name}`,
        capabilityLinkValues: [primaryUrl, declineUrl],
        linkSecretFingerprint,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          ...buildEventInviteRecipientVariables(
            { firstName: invite.inviteeFirstName, lastName: invite.inviteeLastName },
            inviteType === "attendee" ? "Attendee" : "Speaker",
          ),
          inviterName: emailPlainText(inviterName),
          [primaryKey]: primaryUrl,
          declineUrl,
        },
      };
    },
  });

  return {
    response: {
      success: true,
      created: outcomes.filter((outcome) => outcome.status === "created").map(({ email }) => ({ email })),
      endorsed: outcomes.filter((outcome) => outcome.status === "endorsed").map(({ email }) => ({ email })),
      skipped: outcomes
        .filter((outcome) => outcome.status === "skipped")
        .map(({ email, reason }) => ({ email, reason: reason ?? "invitee_ineligible" })),
      ...(referralCode ? { referralCode } : {}),
    },
    outboxIds: outcomes.flatMap((outcome) => (outcome.outboxId ? [outcome.outboxId] : [])),
  };
}
