/** An event's configured attendance options, one of them not a type the product knows by name. */
export function configuredDays() {
  const options = ["in_person", "virtual", "livestream_lounge"].map((value) => ({ value, label: value }));
  const day = { id: "day-1", date: "2026-09-01", label: null, startsAt: null, endsAt: null, sortOrder: 0 };
  return { days: [{ ...day, attendanceOptions: options, attendanceCounts: {} }], eventUpdatedAt: "2026-08-01T00:00Z" };
}
