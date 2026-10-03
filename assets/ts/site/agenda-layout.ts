import type { ContentAgendaDay } from "../../shared/site-agenda";

/** Native table spans preserve room alignment across overlapping time slots. */
export function agendaRows(day: ContentAgendaDay, controlsHeight = 0) {
  const occupiedUntil = day.locations.map(() => 0);
  const rows = day.slots.map((slot, index) => ({
    slot,
    cells: day.locations.map((location, column) => {
      if (occupiedUntil[column]! > index) return null;
      const sessions = slot.sessions.filter((session) =>
        session.locations.length ? session.locations.includes(location.id) : column === 0,
      );
      const endsAt = Math.max(...sessions.map((session) => Date.parse(session.endsAt ?? slot.startsAt)));
      let rowSpan = 1;
      for (let next = index + 1; next < day.slots.length; next++) {
        const following = day.slots[next]!;
        if (
          Date.parse(following.startsAt) >= endsAt ||
          (!controlsHeight && !following.sessions.length) ||
          following.sessions.some((session) => session.locations.includes(location.id))
        )
          break;
        rowSpan++;
      }
      occupiedUntil[column] = index + rowSpan;
      return { rowSpan, sessions };
    }),
  }));
  const floors = day.slots.map(() => 0);
  rows.forEach(({ cells }, index) => {
    cells.forEach((cell) =>
      cell?.sessions.forEach((session) => {
        const titleLines = Math.min(3, Math.ceil(session.title.length / 28));
        const required =
          70 + controlsHeight + titleLines * 24 + session.speakers.length * 50 + (session.descriptionHtml ? 68 : 0);
        for (let row = index; row < index + cell.rowSpan; row++) {
          floors[row] = Math.max(floors[row]!, Math.ceil(required / cell.rowSpan));
        }
      }),
    );
  });
  return rows.map((row, index) => {
    const next = day.slots[index + 1];
    const elapsed = next
      ? (Date.parse(next.startsAt) - Date.parse(row.slot.startsAt)) / 60_000
      : (row.slot.durationMinutes ?? 30);
    return { ...row, height: row.slot.sessions.length ? Math.max(floors[index]!, Math.max(1, elapsed) * 8) : 64 };
  });
}
