import type { z } from "zod";
import type {
  registrationInviteCreateSchema,
  peerInviteResultSchema,
} from "../../../assets/shared/schemas/registration";
import { canSendPeerInvitations } from "../../../assets/shared/peer-invitation-policy";
import { resolveEventInviteExpiry } from "../invite-validity";
import { batchFirst } from "../db/pagination";
import { AppError } from "../errors";
import { getConfig, resolveAppBaseUrl } from "../config";
import { buildEventEmailVariables, getEventBySlug } from "./events";
import { resolvePeerInvitationAuthority } from "./peer-invitation-authority";
import { prepareInvitesByInviterCount } from "./invite-creation";
import { bulkCreateInvites } from "./invite-bulk";
import { prepareReferralCodeStatement } from "./referrals";
import { firstReferralCodeQuerySql } from "./referral-code-projection";
import { inviteDeclineUrl, proposalPageUrl, registrationPageUrl } from "./frontend-links";
import type { Env } from "../types";
import { emailPlainText } from "../email/plain-text";
import { REGISTRATION_ORGANIZATION_SQL } from "./registrations/selected-identity";
import { buildEventInviteRecipientVariables } from "./event-invite-email-variables";

type PeerInviteBody = z.infer<typeof registrationInviteCreateSchema>;

export interface PeerInviteCreationResult {
  response: z.infer<typeof peerInviteResultSchema>;
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

/** Shared attendee-invite/speaker-nomination workflow and D1 bulk boundary. */
export async function createPeerInvitations(
  env: Env,
  request: Request,
  eventSlug: string,
  body: PeerInviteBody,
  inviteType: "attendee" | "speaker",
): Promise<PeerInviteCreationResult> {
  // Only this primary-key conflict is retryable: the batch has rolled back
  // either a competing owner code or a random-code collision, including its outbox.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await createPeerInvitationAttempt(env, request, eventSlug, body, inviteType);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint failed: referral_codes.code"))
        throw error;
    }
  }
  throw new AppError(409, "REFERRAL_CODE_CONFLICT", "Try sending your invitations again.");
}

async function createPeerInvitationAttempt(
  env: Env,
  request: Request,
  eventSlug: string,
  body: PeerInviteBody,
  inviteType: "attendee" | "speaker",
): Promise<PeerInviteCreationResult> {
  const event = await getEventBySlug(env.DB, eventSlug);
  const { registration, db } = await resolvePeerInvitationAuthority(env, request, event.id, inviteType);

  if (inviteType === "attendee" && !canSendPeerInvitations(registration.status, event.starts_at)) {
    throw new AppError(403, "PEER_INVITATIONS_CLOSED", "Colleague invitations close when the event starts.");
  }
  const requestedExpiry = resolveEventInviteExpiry(event, body.expiresAt);
  const expiresAt =
    inviteType === "attendee" && requestedExpiry > event.starts_at! ? event.starts_at! : requestedExpiry;
  const config = getConfig(env, request);
  const maxAllowed =
    inviteType === "attendee"
      ? (event.invite_limit_attendee ?? config.inviteLimitPerAttendee)
      : (event.invite_limit_speaker_nomination ?? config.inviteLimitSpeakerNomination);
  const [countResult, userResult, referralResult] = await env.DB.batch([
    prepareInvitesByInviterCount(env.DB, event.id, registration.user_id, inviteType),
    env.DB.prepare(`SELECT u.first_name, u.last_name, ${REGISTRATION_ORGANIZATION_SQL} AS organization_name
       FROM registrations r JOIN users u ON u.id = r.user_id WHERE r.id = ?`).bind(registration.id),
    ...(inviteType === "attendee"
      ? [env.DB.prepare(firstReferralCodeQuerySql("registration", "?")).bind(registration.id)]
      : []),
  ]);
  const currentCount = Number(batchFirst<{ total: number }>(countResult)?.total ?? 0);
  if (currentCount + body.invites.length > maxAllowed) {
    throw new AppError(
      429,
      "INVITE_LIMIT_EXCEEDED",
      `Invite limit reached. You can send up to ${maxAllowed} invitations for this event.`,
    );
  }

  const user = batchFirst<{ first_name: string | null; last_name: string | null; organization_name: string | null }>(
    userResult,
  );
  const inviterName = displayName(user);
  const appBaseUrl = resolveAppBaseUrl(env, request);
  const existingReferral = referralResult ? batchFirst<{ code: string }>(referralResult)?.code : undefined;
  const preparedReferral =
    inviteType === "attendee" && !existingReferral
      ? await prepareReferralCodeStatement(env.DB, {
          eventId: event.id,
          ownerType: "registration",
          ownerId: registration.id,
          createdByUserId: registration.user_id,
          length: config.referralCodeLength,
          firstForOwner: true,
        })
      : null;
  const referralCode = inviteType === "attendee" ? (existingReferral ?? preparedReferral?.code) : undefined;

  const outcomes = await bulkCreateInvites(db, inviteType, {
    event,
    additionalStatements: preparedReferral ? [preparedReferral.statement] : [],
    expiresAt,
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
