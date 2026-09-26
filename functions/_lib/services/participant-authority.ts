/** A session grants access through ownership, never through an emailed capability. */
export type ParticipantAuthority = string | { resourceId: string; userId: string };
