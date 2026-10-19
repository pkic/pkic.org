/** Half-open occupancy plus the same location-change buffer used by backend guards. */
export function agendaDutyIntervalsConflict(
  a: { startAt: string; endAt: string; roomId: string | null },
  b: { startAt: string; endAt: string; roomId: string | null },
  travelMinutes = 0,
) {
  const buffer = a.roomId !== b.roomId ? travelMinutes * 60000 : 0;
  return Date.parse(a.startAt) < Date.parse(b.endAt) + buffer && Date.parse(b.startAt) < Date.parse(a.endAt) + buffer;
}
