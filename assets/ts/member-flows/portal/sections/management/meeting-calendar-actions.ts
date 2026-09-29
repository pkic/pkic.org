export function downloadMeetingCalendar(groupId: string, seriesId: string, occurrenceId?: string): void {
  const path = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(seriesId)}/calendar.ics`;
  window.open(occurrenceId ? `${path}?occurrenceId=${encodeURIComponent(occurrenceId)}` : path, "_self");
}
