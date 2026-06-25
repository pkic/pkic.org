import { nowIso } from "../utils/time";
import { runInviteReminders } from "./reminders/invite-reminders";
import { runCoSpeakerInviteReminders } from "./reminders/cospeaker-reminders";
import { runPresentationReminders } from "./reminders/presentation-reminders";
import { runConfirmationReminders } from "./reminders/confirmation-reminders";
import type { ReminderCandidatePreview } from "./reminders-support";
import type { DatabaseLike } from "../types";

export async function runReminderCycle(
  db: DatabaseLike,
  payload: {
    appBaseUrl: string;
    reminderIntervalDays: number;
    pendingConfirmationReminderIntervalDays: number;
    maxInviteReminders: number;
    maxPendingConfirmationReminders: number;
    maxPresentationReminders: number;
    limit: number;
    dryRun?: boolean;
  },
): Promise<{
  inviteRemindersQueued: number;
  speakerInviteRemindersQueued: number;
  presentationRemindersQueued: number;
  confirmationRemindersQueued: number;
  confirmationCancellationsProcessed: number;
  processed: number;
  preview: {
    attendeeInvites: ReminderCandidatePreview[];
    speakerInvites: ReminderCandidatePreview[];
    coSpeakerInvites: ReminderCandidatePreview[];
    presentationUploads: ReminderCandidatePreview[];
    registrationConfirmations: ReminderCandidatePreview[];
  };
}> {
  const now = nowIso();
  const cutoff = new Date(Date.now() - payload.reminderIntervalDays * 86_400_000).toISOString();
  const pendingConfirmationIntervalDays = Math.max(1, payload.pendingConfirmationReminderIntervalDays);
  const pendingConfirmationFallbackDeadlineDays =
    (payload.maxPendingConfirmationReminders + 1) * pendingConfirmationIntervalDays;
  const confirmationCutoff = new Date(Date.now() - pendingConfirmationIntervalDays * 86_400_000).toISOString();

  const sharedParams = { appBaseUrl: payload.appBaseUrl, now, cutoff, dryRun: payload.dryRun };

  const invites = await runInviteReminders(db, {
    ...sharedParams,
    limit: payload.limit,
    maxInviteReminders: payload.maxInviteReminders,
  });
  const remaining1 = Math.max(0, payload.limit - invites.inviteRemindersQueued);

  const coSpeaker = await runCoSpeakerInviteReminders(db, {
    ...sharedParams,
    limit: remaining1,
    maxInviteReminders: payload.maxInviteReminders,
  });
  const remaining2 = Math.max(0, remaining1 - coSpeaker.speakerInviteRemindersQueued);

  const presentations = await runPresentationReminders(db, {
    ...sharedParams,
    limit: remaining2,
    maxPresentationReminders: payload.maxPresentationReminders,
  });
  const remaining3 = Math.max(0, remaining2 - presentations.presentationRemindersQueued);

  const confirmations = await runConfirmationReminders(db, {
    ...sharedParams,
    limit: remaining3,
    maxPendingConfirmationReminders: payload.maxPendingConfirmationReminders,
    pendingConfirmationIntervalDays,
    pendingConfirmationFallbackDeadlineDays,
    confirmationCutoff,
  });

  const processed =
    invites.inviteRemindersQueued +
    coSpeaker.speakerInviteRemindersQueued +
    presentations.presentationRemindersQueued +
    confirmations.confirmationRemindersQueued +
    confirmations.confirmationCancellationsProcessed;

  return {
    inviteRemindersQueued: invites.inviteRemindersQueued,
    speakerInviteRemindersQueued: coSpeaker.speakerInviteRemindersQueued,
    presentationRemindersQueued: presentations.presentationRemindersQueued,
    confirmationRemindersQueued: confirmations.confirmationRemindersQueued,
    confirmationCancellationsProcessed: confirmations.confirmationCancellationsProcessed,
    processed,
    preview: {
      attendeeInvites: invites.attendeeInvites,
      speakerInvites: invites.speakerInvites,
      coSpeakerInvites: coSpeaker.coSpeakerInvites,
      presentationUploads: presentations.presentationUploads,
      registrationConfirmations: confirmations.registrationConfirmations,
    },
  };
}
