import type { ContentAgendaDay } from "../../shared/site-agenda";

/** Native table spans preserve room alignment across overlapping time slots. */
export function agendaRows(day: ContentAgendaDay, controlsHeight = 0, calendar = false) {
  // An unassigned display column does not create or assign a physical room.
  const columnCount = Math.max(1, day.locations.length);
  const occupiedUntil = Array.from({ length: columnCount }, () => 0);
  const rows = day.slots.map((slot, index) => {
    const placements = Array.from({ length: columnCount }, (_, column) =>
      slot.sessions.filter(
        (session) =>
          !day.locations.length ||
          (session.locations.length ? session.locations.includes(day.locations[column]!.id) : column === 0),
      ),
    );
    const globalBreak =
      slot.sessions.length > 0 &&
      occupiedUntil.every((end) => end <= index) &&
      slot.sessions.every((session) => session.kind === "break" && session.locations.length === 0);
    return {
      slot,
      cells: placements.map((sessions, column) => {
        if (occupiedUntil[column]! > index) return null;
        if (globalBreak && column > 0) return null;
        let colSpan = globalBreak ? columnCount : 1;
        if (!globalBreak && sessions.length) {
          while (column + colSpan < columnCount) {
            const next = placements[column + colSpan]!;
            if (
              occupiedUntil[column + colSpan]! > index ||
              next.length !== sessions.length ||
              next.some((session, position) => session !== sessions[position])
            )
              break;
            colSpan++;
          }
        }
        const roomIds = day.locations.slice(column, column + colSpan).map((room) => room.id);
        const endsAt = Math.max(...sessions.map((session) => Date.parse(session.endsAt ?? slot.startsAt)));
        let rowSpan = 1;
        for (let next = index + 1; next < day.slots.length; next++) {
          const following = day.slots[next]!;
          if (
            Date.parse(following.startsAt) >= endsAt ||
            (!following.sessions.length && Boolean(following.title || following.durationMinutes)) ||
            (globalBreak
              ? following.sessions.length > 0
              : !day.locations.length
                ? following.sessions.length > 0
                : following.sessions.some((session) => session.locations.some((id) => roomIds.includes(id))))
          )
            break;
          rowSpan++;
        }
        occupiedUntil.fill(index + rowSpan, column, column + colSpan);
        return { rowSpan, colSpan, sessions };
      }),
    };
  });
  const floors = day.slots.map(() => 0);
  rows.forEach(({ cells }, index) => {
    cells.forEach((cell) =>
      cell?.sessions.forEach((session) => {
        const titleLines = Math.max(1, Math.ceil(session.title.length / 28));
        const actionCount =
          Number(Boolean(session.sessionUrl)) +
          Number(Boolean(session.youtube || session.recordingUrl)) +
          Number(Boolean(session.presentationUrl)) +
          Number(!controlsHeight && Boolean(session.participation));
        // Two short actions fit the existing 19rem column; additional links wrap.
        const actionHeight = Math.ceil(actionCount / 2) * 32;
        const required =
          70 +
          controlsHeight +
          titleLines * 24 +
          session.speakers.length * 50 +
          (session.descriptionMarkdown || session.descriptionHtml ? 68 : 0) +
          actionHeight;
        for (let row = index; row < index + cell.rowSpan; row++) {
          floors[row] = Math.max(floors[row]!, Math.ceil(required / cell.rowSpan));
        }
      }),
    );
  });
  const layout = rows.map((row, index) => {
    const next = day.slots[index + 1];
    const elapsed = next
      ? (Date.parse(next.startsAt) - Date.parse(row.slot.startsAt)) / 60_000
      : (row.slot.durationMinutes ?? (calendar ? 5 : 30));
    const sourceOnly = row.slot.sessions.length > 0 && row.slot.sessions.every((session) => session.endNotRecorded);
    return {
      ...row,
      compactBreak: false,
      breakInterior: false,
      height: sourceOnly
        ? floors[index]!
        : Math.max(floors[index]!, Math.ceil(Math.max(1, elapsed) * 1.6), next ? 0 : 56),
    };
  });
  // A full-width break is a compact visual interval, not a shorter scheduled interval.
  // Every original row remains available to the editor's UTC-based hit mapping.
  layout.forEach((row, index) => {
    const cells = row.cells.filter((cell) => cell !== null);
    if (!cells.length || cells.reduce((count, cell) => count + cell.colSpan, 0) !== columnCount) return;
    const sessions = cells.flatMap((cell) => cell.sessions);
    const span = cells[0]!.rowSpan;
    const end = sessions[0]?.endsAt;
    if (
      controlsHeight ||
      !end ||
      !Number.isFinite(Date.parse(end)) ||
      end <= row.slot.startsAt ||
      day.slots[index + span]?.startsAt !== end ||
      cells.some((cell) => cell.sessions.length !== 1 || cell.rowSpan !== span) ||
      sessions.some(
        (session) =>
          session.kind !== "break" ||
          session.endNotRecorded ||
          session.endsAt !== end ||
          session.title.length > 28 ||
          session.speakers.length ||
          session.descriptionMarkdown?.trim() ||
          session.descriptionHtml.trim() ||
          session.youtube ||
          session.recordingUrl ||
          session.presentationUrl ||
          session.onlineAccessUrl ||
          session.participation,
      )
    )
      return;
    const start = Date.parse(row.slot.startsAt);
    const finish = Date.parse(end);
    const normalOverlap = day.slots.some(
      (slot) =>
        Date.parse(slot.startsAt) < finish &&
        slot.sessions.some(
          (session) =>
            session.kind !== "break" &&
            (!session.endsAt || !Number.isFinite(Date.parse(session.endsAt)) || Date.parse(session.endsAt) > start),
        ),
    );
    if (normalOverlap) return;
    // 52px bar plus its existing 4px top/bottom inset; never create zero-height ticks.
    const total = Math.max(60, span);
    const base = Math.floor(total / span);
    const remainder = total % span;
    for (let offset = 0; offset < span; offset++) {
      const covered = layout[index + offset]!;
      covered.height = base + Number(offset < remainder);
      covered.compactBreak = true;
      covered.breakInterior = offset > 0;
    }
  });
  // Authored title-only breaks (Lunch, Break) get the same compact bar when no session runs through them.
  layout.forEach((row, index) => {
    const next = day.slots[index + 1];
    if (controlsHeight || row.compactBreak || row.slot.sessions.length || !row.slot.title || !next) return;
    const start = Date.parse(row.slot.startsAt);
    const finish = Date.parse(next.startsAt);
    const overlapped = day.slots.some(
      (slot) =>
        Date.parse(slot.startsAt) < finish &&
        slot.sessions.some(
          (session) =>
            session.kind !== "break" &&
            (!session.endsAt || !Number.isFinite(Date.parse(session.endsAt)) || Date.parse(session.endsAt) > start),
        ),
    );
    if (overlapped) return;
    row.height = Math.min(row.height, 60);
    row.compactBreak = true;
  });
  return layout;
}
