import {
  prepareMeetingGuestBrowserChallenge,
  type PreparedMeetingGuestBrowserChallenge,
} from "../../auth/meeting-guest-challenge";
import type { MeetingGuest } from "../../auth/meeting-guest-record";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { prepareMeetingGuestVerificationCodeDelivery } from "./guest-delivery";

async function requireGuestOccurrenceEligibility(
  db: DatabaseLike,
  guestId: string,
  occurrenceId: string,
): Promise<void> {
  const eligible = await first<{ eligible: number }>(
    db,
    `SELECT 1 AS eligible
       FROM current_event_occurrence_subject_eligibility
      WHERE occurrence_id = ? AND guest_id = ? AND user_id IS NULL
      LIMIT 1`,
    [occurrenceId, guestId],
  );
  if (!eligible) {
    throw new AppError(404, "MEETING_GUEST_INVITATION_INVALID", "Meeting invitation is invalid or no longer eligible");
  }
}

function translateChallengeInsertError(error: unknown): never {
  if (error instanceof Error && error.message.includes("MEETING_GUEST_CHALLENGE_RATE_LIMITED")) {
    throw new AppError(429, "MEETING_GUEST_CHALLENGE_RATE_LIMITED", "A verification code was requested too recently", {
      retryAfter: 60,
    });
  }
  if (error instanceof Error && error.message.includes("MEETING_GUEST_CHALLENGE_CONTEXT_CHANGED")) {
    throw new AppError(404, "MEETING_GUEST_INVITATION_INVALID", "Meeting invitation is invalid or no longer eligible");
  }
  throw error;
}

export interface StartedMeetingGuestVerification {
  challenge: PreparedMeetingGuestBrowserChallenge;
  outboxId: string;
}

export async function startMeetingGuestVerification(
  db: DatabaseLike,
  guest: MeetingGuest,
  occurrenceId: string,
): Promise<StartedMeetingGuestVerification> {
  await requireGuestOccurrenceEligibility(db, guest.guestId, occurrenceId);
  const challenge = await prepareMeetingGuestBrowserChallenge(db, guest, occurrenceId);
  const delivery = prepareMeetingGuestVerificationCodeDelivery(db, {
    challengeId: challenge.challengeId,
    recipientEmail: guest.normalizedEmail,
    guestName: guest.name,
    verificationCode: challenge.verificationCode,
    expiresAt: challenge.expiresAt,
  });
  try {
    await db.batch([challenge.statement, delivery.statement]);
  } catch (error) {
    translateChallengeInsertError(error);
  }
  return {
    challenge,
    outboxId: delivery.id,
  };
}
