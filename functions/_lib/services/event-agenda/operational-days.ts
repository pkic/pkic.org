import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
export interface OperationalDayPerson {
  day_date: string;
  user_id: string;
  sources: string[];
}
/** Venue civil dates intersecting [start,end); exact midnight does not allocate the next day. */
export function operationalIntervalDays(start: string, end: string, timeZone: string): string[] {
  const startMs = Date.parse(start),
    endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
    throw new AppError(409, "AGENDA_PERSON_INTERVAL_INVALID", "An operational assignment has an invalid interval.");
  const first = instantToDateTimeLocal(new Date(startMs).toISOString(), timeZone).slice(0, 10);
  const last = instantToDateTimeLocal(new Date(endMs - 1).toISOString(), timeZone).slice(0, 10);
  const dates: string[] = [];
  for (
    let date = first;
    date <= last;
    date = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  ) {
    if (dates.length >= 366)
      throw new AppError(
        422,
        "AGENDA_PERSON_INTERVAL_TOO_LONG",
        "Operational intervals must span at most 366 venue days.",
      );
    dates.push(date);
  }
  return dates;
}
/** Event-day capacity includes standalone staff shifts, independently of linked sessions or attendee registration. */
export function operationalDays(snapshot: AgendaSnapshot): OperationalDayPerson[] {
  const people = new Map<string, OperationalDayPerson>();
  const add = (userId: string, start: string, end: string, source: string) => {
    for (const date of operationalIntervalDays(start, end, snapshot.timeZone)) {
      const key = `${date}:${userId}`,
        prior = people.get(key);
      if (prior) prior.sources.push(source);
      else people.set(key, { day_date: date, user_id: userId, sources: [source] });
    }
  };
  for (const session of snapshot.occurrences)
    if (session.startAt && session.endAt)
      for (const speaker of session.speakers)
        if (speaker.role !== "proposer" && (speaker.attendanceMode ?? "physical") === "physical")
          add(speaker.userId, session.startAt, session.endAt, `credit:${session.id}:${speaker.role ?? "speaker"}`);
  const members = new Map(snapshot.roleMembers.map((member) => [member.userId, member]));
  const shifts = new Map(snapshot.shifts.map((shift) => [shift.id, shift]));
  for (const assignment of snapshot.assignments) {
    const member = members.get(assignment.userId),
      shift = shifts.get(assignment.shiftId);
    if (!member || !shift)
      throw new AppError(409, "AGENDA_STAFF_MEMBER_MISSING", "An assigned staff member or shift is missing.");
    if (member.attendanceMode === "physical")
      add(member.userId, shift.startAt, shift.endAt, `shift:${shift.id}:${assignment.role}`);
  }
  return [...people.values()];
}
export function prepareOperationalDays(
  db: DatabaseLike,
  eventId: string,
  revision: number,
  people: OperationalDayPerson[],
) {
  return db
    .prepare(
      "INSERT INTO event_agenda_operational_days(event_id,revision,day_date,user_id,sources_json) SELECT ?,?,json_extract(value,'$.day_date'),json_extract(value,'$.user_id'),json_extract(value,'$.sources') FROM json_each(?)",
    )
    .bind(eventId, revision, JSON.stringify(people));
}
export const liveOperationalDaysSql =
  "SELECT person.event_id,person.day_date,person.user_id FROM event_agenda_operational_days person JOIN event_agenda_state state ON state.event_id=person.event_id AND state.published_revision=person.revision";
