import { meetingSeriesCalendarPath } from "../../../../../shared/calendar-subscription-links";

export function downloadMeetingCalendar(groupId: string, seriesId: string, occurrenceId?: string): void {
  window.open(meetingSeriesCalendarPath(groupId, seriesId, { occurrenceId }), "_self");
}
