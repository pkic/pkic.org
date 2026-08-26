import { queuedCapabilityTokenBoundToSecret } from "../../auth/capability-links";
import { prepareQueueEmailStatement } from "../../email/outbox";
import type { DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";

const MAX_INVITATION_CAPABILITY_TTL_SECONDS = 30 * 24 * 60 * 60;

interface GuestInvitationDeliveryInput {
  guestId: string;
  invitationSecret: string;
  invitationVersion: number;
  expiresAt: string;
  recipientEmail: string;
  guestName: string;
  eventName: string;
  startsAt: string;
  occurrenceId: string;
  appBaseUrl: string;
}

function invitationCapabilityTtlSeconds(expiresAt: string): number {
  const remainingSeconds = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1_000);
  return Math.max(1, Math.min(MAX_INVITATION_CAPABILITY_TTL_SECONDS, remainingSeconds));
}

export async function prepareMeetingGuestInvitationDelivery(db: DatabaseLike, input: GuestInvitationDeliveryInput) {
  const queuedToken = await queuedCapabilityTokenBoundToSecret(
    "meeting_guest_verify",
    input.guestId,
    input.invitationSecret,
    invitationCapabilityTtlSeconds(input.expiresAt),
  );
  const invitationUrl = `${input.appBaseUrl}/meetings/join/#/verify?token=${encodeURIComponent(
    queuedToken,
  )}&occurrence=${encodeURIComponent(input.occurrenceId)}`;
  return prepareQueueEmailStatement(db, {
    outboxId: uuid(),
    idempotencyKey: `meeting-guest-invitation:${input.guestId}:${input.invitationVersion}`,
    templateKey: "meeting-guest-invitation",
    recipientEmail: input.recipientEmail,
    messageType: "transactional",
    data: {
      guestName: input.guestName,
      eventName: input.eventName,
      startsAt: input.startsAt,
      invitationUrl,
    },
    capabilityLinkValues: [invitationUrl],
  });
}

export function prepareMeetingGuestVerificationCodeDelivery(
  db: DatabaseLike,
  input: {
    challengeId: string;
    recipientEmail: string;
    guestName: string;
    verificationCode: string;
    expiresAt: string;
  },
) {
  return prepareQueueEmailStatement(db, {
    outboxId: uuid(),
    idempotencyKey: `meeting-guest-verification-code:${input.challengeId}`,
    templateKey: "meeting-guest-verification-code",
    recipientEmail: input.recipientEmail,
    messageType: "transactional",
    data: {
      guestName: input.guestName,
      verificationCode: input.verificationCode,
      expiresAt: input.expiresAt,
    },
  });
}
