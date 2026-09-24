import { databaseIdSchema } from "./schemas/identifiers";
import { isPersonalMeetingToken } from "./meeting-personal-token";

export function meetingEntryUrl(occurrenceId: string): string {
  return `/meetings/join/?occurrence=${encodeURIComponent(occurrenceId)}`;
}

export function meetingSeriesEntryUrl(seriesId: string): string {
  return `/meetings/join/?series=${encodeURIComponent(seriesId)}`;
}

export function meetingEntrySignInUrl(occurrenceId: string): string {
  return `/portal/#/meeting-entry/${encodeURIComponent(occurrenceId)}`;
}

export function meetingSeriesEntrySignInUrl(seriesId: string): string {
  return `/portal/#/meeting-series-entry/${encodeURIComponent(seriesId)}`;
}

export function personalMeetingEntrySignInUrl(token: string): string {
  return `/portal/#/meeting-link/${encodeURIComponent(token)}`;
}

export function personalMeetingEntryUrl(token: string): string {
  return `/m/#token=${encodeURIComponent(token)}`;
}

/** Only this fixed same-site destination can be resumed after portal authentication. */
export function meetingEntryReturnUrl(hash: string): string | null {
  const personal = /^#\/meeting-link\/([^/?#]+)$/.exec(hash);
  if (personal && isPersonalMeetingToken(personal[1])) return personalMeetingEntryUrl(personal[1]);
  const match = /^#\/(meeting-entry|meeting-series-entry)\/([^/?#]+)$/.exec(hash);
  const id = databaseIdSchema.safeParse(match?.[2]);
  if (!id.success) return null;
  return match?.[1] === "meeting-series-entry" ? meetingSeriesEntryUrl(id.data) : meetingEntryUrl(id.data);
}
