/**
 * Every speaker on a proposal needs an acceptance. An organizer may record
 * it on their behalf, confirming their identity and the event terms with a notification. Until a speaker has accepted, organizers
 * see them as pending and the public agenda does not show them.
 */

/** Shown to organizers on a speaker who has not accepted their invitation yet. */
export const SPEAKER_NOT_YET_ACCEPTED_LABEL = "Not yet accepted";

/** Shown to organizers on a session whose speakers have not all accepted yet. */
export function pendingSpeakersLabel(count: number): string {
  return count === 1 ? "1 speaker not yet accepted" : `${count} speakers not yet accepted`;
}

/** The refusal an agenda approval gives while a proposal's speaker has not accepted yet. */
export const SPEAKER_ACCEPTANCE_REQUIRED_MESSAGE =
  "Every speaker needs an accepted invitation before the agenda is approved. Accept on behalf of speakers and confirm their identity and event terms, wait for their acceptance, or remove them from their sessions.";

/** Replies and objections to organizer acceptance go to the consortium. */
export const SPEAKER_ACCEPTANCE_CONTACT_EMAIL = "contact@pkic.org";
