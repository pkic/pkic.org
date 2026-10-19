import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaContent } from "../../../../../../../shared/public-agenda-content";
import { formatClockInZone, formatDayList } from "../../../../../../../shared/format-date";

export interface LiveSessionChoice {
  id: string;
  roomId: string | null;
  roomIds: string[];
  title: string;
  startsAt: string;
  endsAt: string;
  /** "Room · 14:00 · Title", on the event's own 24-hour clock. */
  label: string;
}

export interface LiveSessionDay {
  date: string;
  label: string;
  choices: LiveSessionChoice[];
}

/**
 * The sessions a live room exists for, by day: scheduled, non-break sessions
 * of the approved agenda. A placeholder ("To be announced") has no room yet,
 * so it is not offered.
 */
export function liveSessionDays(snapshot: AgendaSnapshot): LiveSessionDay[] {
  const content = agendaContent(snapshot, false, { participant: true });
  return content.days
    .map((day) => {
      const rooms = new Map(day.locations.map((location) => [location.id, location.label]));
      // Within one start time, the locations follow the agenda's own column order.
      const position = (roomId: string | null) => {
        const index = day.locations.findIndex((location) => location.id === roomId);
        return index < 0 ? day.locations.length : index;
      };
      const choices = day.slots.flatMap((slot) =>
        slot.sessions.flatMap((session) => {
          if (!session.id || session.kind === "break" || session.placeholder || !session.endsAt) return [];
          const roomId = session.locations?.[0] ?? null;
          const room = (session.locations ?? []).map((id) => rooms.get(id)).filter(Boolean);
          const parts = [
            ...(room.length ? [room.join(" + ")] : []),
            formatClockInZone(slot.startsAt, snapshot.timeZone),
          ];
          return [
            {
              id: session.id,
              roomId,
              roomIds: session.locations ?? [],
              title: session.title,
              startsAt: slot.startsAt,
              endsAt: session.endsAt,
              label: [...parts, session.title].join(" · "),
            },
          ];
        }),
      );
      choices.sort(
        (a, b) =>
          a.startsAt.localeCompare(b.startsAt) ||
          position(a.roomId) - position(b.roomId) ||
          a.label.localeCompare(b.label),
      );
      return { date: day.date, label: formatDayList([day.date]), choices };
    })
    .filter((day) => day.choices.length);
}

/**
 * The session an operator most likely wants: the one on now, else the next,
 * in their room when they have one, else in any room.
 */
export function defaultLiveSession(
  days: readonly LiveSessionDay[],
  now: number,
  roomId: string | null,
): LiveSessionChoice | undefined {
  const upcoming = days
    .flatMap((day) => day.choices)
    .filter((choice) => Date.parse(choice.endsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (roomId ? upcoming.find((choice) => choice.roomIds.includes(roomId)) : undefined) ?? upcoming[0];
}

/** Room-first grouping retains the same occurrence when it spans several rooms. */
export function liveRoomChoices(days: readonly LiveSessionDay[], roomId: string, now: number) {
  const choices = days.flatMap((day) => day.choices).filter((choice) => !roomId || choice.roomIds.includes(roomId));
  const current = choices.filter((choice) => Date.parse(choice.startsAt) <= now && Date.parse(choice.endsAt) > now);
  const upcoming = choices.filter((choice) => Date.parse(choice.startsAt) > now);
  const next = upcoming.slice(0, 1);
  const other = choices.filter((choice) => !current.includes(choice) && !next.includes(choice));
  return [
    { label: "Now", choices: current },
    { label: "Next", choices: next },
    { label: "Other sessions", choices: other },
  ].filter((group) => group.choices.length);
}
