import { isPersonalAgendaSession } from "../../../../../../site/AgendaParticipationControls";
/**
 * My agenda: the reader's starred and booked sessions as a compact list per
 * day — time, title, room, their seat and their star — rather than the whole
 * timetable with every other room and slot left empty.
 *
 * A session un-starred here stays listed, star cleared, until the reader
 * leaves, so a slip of the finger is undone where it happened.
 */
import { useRef } from "preact/hooks";
import type { ContentAgendaDay } from "../../../../../../../shared/site-agenda";
import type { ClockZone } from "../../../../../../../shared/event-clock";
import {
  formatClockName,
  formatClockRangeInZone,
  formatDayAndMonth,
  formatWeekday,
} from "../../../../../../../shared/format-date";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { AgendaClockNote, AgendaSessionRow, AgendaSessionRows } from "../../../../../../site/AgendaSessionRow";
import {
  SessionHeldBadge,
  SessionStarButton,
  type AgendaPersonalSession,
} from "../../../../../../site/AgendaParticipationControls";

export function MyAgendaList({
  days,
  clock,
  session,
  sessionHref,
}: {
  days: readonly ContentAgendaDay[];
  clock: ClockZone;
  /** The reader's marks on one session, or nothing when it takes no participation. */
  session: (id: string) => AgendaPersonalSession | undefined;
  /** Where a row's title opens that session's details. */
  sessionHref: (id: string) => string;
}) {
  const listed = useRef(new Set<string>());
  const groups = days
    .map((day) => ({
      day,
      rows: day.slots.flatMap((slot) =>
        slot.sessions.flatMap((entry) => {
          if (!entry.id) return [];
          const marks = session(entry.id);
          if (marks && isPersonalAgendaSession(marks)) listed.current.add(entry.id);
          if (!marks || !listed.current.has(entry.id)) return [];
          return [{ entry, startsAt: slot.startsAt, marks }];
        }),
      ),
    }))
    .map(({ day, rows }) => ({
      day,
      // A session spanning rooms is one row.
      rows: rows.filter((row, index) => rows.findIndex((other) => other.entry.id === row.entry.id) === index),
    }))
    .filter(({ rows }) => rows.length > 0);
  return (
    <div class="pk-stack">
      <AgendaClockNote clock={formatClockName(clock)} />
      {groups.map(({ day, rows }) => (
        <section key={day.date} class="pk-stack pk-stack--tight" aria-labelledby={`my-agenda-${day.date}`}>
          <SectionHeading level={3} id={`my-agenda-${day.date}`} class="pk-agenda-session-rows__day">
            {formatWeekday(day.date)}, {formatDayAndMonth(day.date)}
          </SectionHeading>
          <AgendaSessionRows>
            {rows.map(({ entry, startsAt, marks }) => (
              <AgendaSessionRow
                key={entry.id}
                dateTime={startsAt}
                when={formatClockRangeInZone(startsAt, entry.endNotRecorded ? undefined : entry.endsAt, clock)}
                title={entry.title}
                open={{ href: sessionHref(entry.id!) }}
                room={entry.locations
                  .map((id) => day.locations.find((location) => location.id === id)?.label)
                  .filter(Boolean)
                  .join(" / ")}
                actions={
                  <>
                    {marks.status && <SessionHeldBadge status={marks.status} />}
                    <SessionStarButton title={entry.title} star={marks} />
                  </>
                }
              />
            ))}
          </AgendaSessionRows>
        </section>
      ))}
    </div>
  );
}
