import { databaseIdSchema } from "./schemas/identifiers";

export function meetingEntryUrl(occurrenceId: string): string {
  return `/meetings/join/?occurrence=${encodeURIComponent(occurrenceId)}`;
}

export function meetingEntrySignInUrl(occurrenceId: string): string {
  return `/portal/#/meeting-entry/${encodeURIComponent(occurrenceId)}`;
}

/** Only this fixed same-site destination can be resumed after portal authentication. */
export function meetingEntryReturnUrl(hash: string): string | null {
  const match = /^#\/meeting-entry\/([^/?#]+)$/.exec(hash);
  const id = databaseIdSchema.safeParse(match?.[1]);
  return id.success ? meetingEntryUrl(id.data) : null;
}
