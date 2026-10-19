/** One occurrence identity shared by personal feeds and recipient calendar requests. */
export function agendaOccurrenceCalendarUid(occurrenceId: string) {
  return `agenda-${occurrenceId}@ics.pkic.org`;
}
export function agendaOccurrenceFromCalendarUid(uid: string) {
  return (
    /^agenda-([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})@ics\.pkic\.org$/i
      .exec(uid)?.[1]
      .toLowerCase() ?? null
  );
}
