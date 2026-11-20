import { buildEventEmailVariables } from "../email/event-email-variables";
import { inviteDeclineSchema } from "../../../assets/shared/schemas/registration";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { getEventById } from "./events";
import { inviteDeclineUrl, proposalPageUrl, registrationPageUrl } from "./frontend-links";
import { bulkCreateInvites } from "./invite-bulk";
import { findInviteByToken, isStaleInviteTransition, prepareDeclineInviteStatements } from "./invite-lifecycle";
import type { InviteRecord } from "./invite-types";
import type { z } from "zod";
import { effectiveStoredInviteExpiry } from "../invite-validity";
import {
  buildEventInvitationMessageVariables,
  buildEventInviteRecipientVariables,
} from "./event-invite-email-variables";

type InviteDeclineBody = z.infer<typeof inviteDeclineSchema>;

export interface DeclineAndForwardInviteInput {
  token: string;
  inviteId?: string;
  body: InviteDeclineBody;
  signingSecret: string;
  appBaseUrl: string;
}

export interface DeclineAndForwardInviteResult {
  forwardedEmails: string[];
  outboxIds: string[];
}

/**
 * Applies the decline transition and any forwarded invitations as one durable
 * database operation. HTTP response construction and background delivery stay
 * at the route boundary; domain validation, links, and email intents live here.
 */
export async function declineAndForwardInvite(
  db: DatabaseLike,
  input: DeclineAndForwardInviteInput,
): Promise<DeclineAndForwardInviteResult> {
  const invite = await findInviteByToken(db, input.token, input.signingSecret, input.inviteId ?? null);
  return declineAndForwardResolvedInvite(db, invite, input);
}

/**
 * The same decline for an invitation already resolved by its caller: the
 * emailed link resolves it by token, the signed-in invitee by their address.
 * `guards` recheck the caller's authorization inside the decline batch.
 */
export async function declineAndForwardResolvedInvite(
  db: DatabaseLike,
  invite: InviteRecord,
  input: { body: InviteDeclineBody; appBaseUrl: string; guards?: StatementLike[] },
): Promise<DeclineAndForwardInviteResult> {
  const event = await getEventById(db, invite.event_id);

  let outcomes;
  try {
    outcomes = await bulkCreateInvites(db, invite.invite_type, {
      event,
      expiresAt: effectiveStoredInviteExpiry(event, invite.expires_at) ?? undefined,
      invites: (input.body.forwards ?? []).map((contact) => ({
        inviteeEmail: contact.email,
        inviteeFirstName: contact.firstName ?? null,
        inviteeLastName: contact.lastName ?? null,
        sourceType: "declined-forward",
      })),
      additionalStatements: [
        ...(input.guards ?? []),
        ...prepareDeclineInviteStatements(db, invite, {
          inviteId: invite.id,
          reasonCode: input.body.reasonCode,
          reasonNote: input.body.reasonNote,
          unsubscribeFuture: input.body.unsubscribeFuture,
          npsScore: input.body.npsScore,
        }),
      ],
      buildEmailRow: ({ inviteId, token, email, invite: contact, linkSecretFingerprint }) => {
        const registrationUrl =
          invite.invite_type === "attendee"
            ? registrationPageUrl(input.appBaseUrl, event, {
                invite: token,
                inviteId,
                source: "invite",
              })
            : undefined;
        const proposalUrl =
          invite.invite_type === "speaker"
            ? proposalPageUrl(input.appBaseUrl, event, {
                invite: token,
                inviteId,
                source: "speaker_invite_forward",
              })
            : undefined;
        const declineUrl = inviteDeclineUrl(input.appBaseUrl, event, token, inviteId);
        return {
          eventId: event.id,
          templateKey: invite.invite_type === "speaker" ? "speaker_invite" : "attendee_invite",
          recipientEmail: email,
          subject: invite.invite_type === "speaker" ? `Speaker invitation: ${event.name}` : `Invitation: ${event.name}`,
          capabilityLinkValues: [registrationUrl, proposalUrl, declineUrl],
          linkSecretFingerprint,
          data: {
            ...buildEventEmailVariables(event, input.appBaseUrl),
            ...buildEventInviteRecipientVariables(
              { firstName: contact.inviteeFirstName, lastName: contact.inviteeLastName },
              invite.invite_type === "attendee" ? "Attendee" : "Speaker",
            ),
            ...(invite.invite_type === "attendee" ? buildEventInvitationMessageVariables(event) : {}),
            registrationUrl,
            proposalUrl,
            declineUrl,
          },
        };
      },
    });
  } catch (error) {
    if (!isStaleInviteTransition(error) && !isAuthorizationGuardFailure(error)) throw error;
    throw new AppError(409, "INVITE_CHANGED", "Invite state changed; please retry");
  }

  return {
    forwardedEmails: outcomes.filter((outcome) => outcome.status === "created").map((outcome) => outcome.email),
    outboxIds: outcomes.flatMap((outcome) => (outcome.outboxId ? [outcome.outboxId] : [])),
  };
}
