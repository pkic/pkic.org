import { zonedDateTimeParts, zonedDateTimeToDate } from "./timezone";

export const MEETING_CALENDAR_RENEWAL_MONTH = 10;
export const MEETING_CALENDAR_OCCURRENCE_LIMIT = 600;
export const MEETING_CALENDAR_RECIPIENT_PAGE = 100;
export const MEETING_PERSONAL_CALENDAR_NOTICE =
  "Sign in with your own account. Personal invitations and calendar replies belong to their recipient; do not forward them. Opening a join link records entry, not verified attendance.";

export function isMeetingLocationUrl(location: string | null | undefined): boolean {
  return /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|\b))/i.test(location ?? "");
}

/** A URL in Location can bypass the tracked join flow; only non-URL locations belong in outbound invitations. */
export function outboundMeetingLocation(location: string | null | undefined): string | null {
  const value = location?.trim();
  return value && !isMeetingLocationUrl(value) ? value : null;
}

/** iCalendar identifies timed recurrence instances at whole-second precision. */
export function meetingRecurrenceId(startsAt: string): string {
  return new Date(Math.floor(Date.parse(startsAt) / 1000) * 1000).toISOString();
}

/** Renew through the following year from October 1 in the meeting's zone. */
export function meetingCalendarThrough(startsAt: string, timezone: string, now: string): string {
  const current = zonedDateTimeParts(new Date(now), timezone);
  const start = zonedDateTimeParts(new Date(startsAt), timezone);
  const year = Math.max(start.year, current.year + (current.month >= MEETING_CALENDAR_RENEWAL_MONTH ? 1 : 0));
  return new Date(
    zonedDateTimeToDate({ year: year + 1, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, timezone).getTime() - 1,
  ).toISOString();
}

export const MEETING_CALENDAR_HELP =
  "Occurrences are generated automatically through year-end. Starting October 1, the calendar extends through the following year. With automatic invitations enabled, group members receive one recurring invitation and calendar updates when meetings change.";
