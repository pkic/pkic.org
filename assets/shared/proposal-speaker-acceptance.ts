/**
 * Every speaker on a proposal accepts for themselves: the proposer's
 * acceptance never stands in for them. Until a speaker has accepted, organizers
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
  "Every speaker must accept their invitation before the agenda is approved. Remove the speakers who haven’t accepted from their sessions, or wait until they do.";
