/**
 * Unfinished registrations: a signed-in person started registering for an
 * event and did not finish. They are reminded a fixed number of times and can
 * say that they will not register, with a reason for the organizers.
 */

/** Hours after the start at which each reminder is due. */
export const UNFINISHED_REGISTRATION_REMINDER_HOURS = [24, 72] as const;

export const UNFINISHED_REGISTRATION_REASONS = [
  "price",
  "schedule_conflict",
  "travel_not_possible",
  "approval_pending",
  "not_relevant",
  "other",
] as const;
export type UnfinishedRegistrationReason = (typeof UNFINISHED_REGISTRATION_REASONS)[number];

export const UNFINISHED_REGISTRATION_REASON_LABELS: Record<UnfinishedRegistrationReason, string> = {
  price: "The price",
  schedule_conflict: "The dates don't work for me",
  travel_not_possible: "I can't travel",
  approval_pending: "My organization hasn't approved it",
  not_relevant: "The program isn't relevant to me",
  other: "Something else",
};

/** When the reminder after `remindersSent` is due, or null when every reminder has gone out. */
export function nextUnfinishedRegistrationReminderAt(startedAt: string, remindersSent: number): string | null {
  const hours = UNFINISHED_REGISTRATION_REMINDER_HOURS[remindersSent];
  return hours === undefined ? null : new Date(Date.parse(startedAt) + hours * 3_600_000).toISOString();
}
