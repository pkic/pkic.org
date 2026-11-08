/**
 * Every speaker on a proposal needs an acceptance. An organizer may record
 * it on their behalf, confirming their identity and the event terms with a notification. Until a speaker has accepted, organizers
 * see them as pending and the public agenda does not show them.
 */

/** Shown to organizers on a speaker who has not accepted their invitation yet. */
export const SPEAKER_NOT_YET_ACCEPTED_LABEL = "Participation not confirmed";

/** Shown to organizers on a session whose speakers have not all accepted yet. */
export function pendingSpeakersLabel(count: number): string {
  return count === 1 ? "1 speaker not yet confirmed" : `${count} speakers not yet confirmed`;
}

/** The refusal an agenda approval gives while a proposal's speaker has not accepted yet. */
export const SPEAKER_ACCEPTANCE_REQUIRED_MESSAGE =
  "Every speaker must confirm willingness to participate before the agenda is approved. Confirm participation, identity, and event terms on their behalf, wait for their response, or remove them from their sessions. Speaker confirmation does not accept a proposal or schedule it.";

/** Replies and objections to organizer acceptance go to the consortium. */
export const SPEAKER_ACCEPTANCE_CONTACT_EMAIL = "contact@pkic.org";

/** Participation is distinct from committee acceptance and program placement. */
export const SPEAKER_PARTICIPATION_COPY = {
  explanation:
    "Confirm your willingness to participate in this proposal. This does not accept the proposal or guarantee inclusion in the program. Committee acceptance and scheduling are separate decisions.",
  confirmedLabel: "Participation confirmed",
  confirmed:
    "Your willingness to participate in this proposal is confirmed. Committee acceptance and scheduling are separate decisions.",
  pending:
    "Your response arrived after the invitation deadline. A replacement may already exist. Your participation in this proposal awaits organizer approval; it is not yet confirmed.",
  pendingLabel: "Late response awaiting review",
  confirm: "Confirm willingness to participate",
};

/** A stored response belongs only to the invitation generation it answered. */
export function isLateSpeakerResponseAwaitingReview(
  status: string,
  responseInviteGeneration: number | null | undefined,
  inviteGeneration: number,
): boolean {
  return status === "pending" && responseInviteGeneration === inviteGeneration;
}

/** SQL counterpart of the review policy; callers supply only trusted column aliases. */
export function lateSpeakerResponseAwaitingReviewSql(speakerAlias: string): string {
  return `(${speakerAlias}.status = 'pending'
    AND ${speakerAlias}.response_invite_generation IS NOT NULL
    AND ${speakerAlias}.response_invite_generation = ${speakerAlias}.invite_generation)`;
}
