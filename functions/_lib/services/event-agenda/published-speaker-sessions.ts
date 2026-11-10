import { dateTimeLocalToIso } from "../../../../assets/shared/timezone";
import { AppError } from "../../errors";

export interface PublishedSessionDayWindow {
  startsFrom: string;
  startsBefore: string;
}

/** The UTC window of one calendar date in the event's own time zone. */
export function agendaDayWindow(dayDate: string, timeZone: string): PublishedSessionDayWindow {
  try {
    const next = new Date(`${dayDate}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      startsFrom: dateTimeLocalToIso(`${dayDate}T00:00`, timeZone),
      startsBefore: dateTimeLocalToIso(`${next.toISOString().slice(0, 10)}T00:00`, timeZone),
    };
  } catch {
    throw new AppError(400, "CAMPAIGN_DAY_FILTER_INVALID", "Choose a day of this event.");
  }
}

/**
 * Eligible session and speaker pairs on the published agenda: public, not a
 * break, still assigned, and credited to an active account. Profile data stays
 * on the user record; callers join it instead of copying it here.
 */
export function publishedSpeakerSessionsSql(
  event: { sql: string; bindings: unknown[] },
  options: { revision?: number; day?: PublishedSessionDayWindow | null } = {},
) {
  const revision =
    options.revision === undefined
      ? {
          sql: `(SELECT published_revision FROM event_agenda_state WHERE event_id=${event.sql})`,
          bindings: event.bindings,
        }
      : { sql: "?", bindings: [options.revision] };
  return {
    sql: `SELECT DISTINCT json_extract(entry.value,'$.id') AS occurrence_id,person.id AS user_id,person.email AS email,
        json_extract(entry.value,'$.title') AS session_title
      FROM event_agenda_publications publication,
        json_each(publication.snapshot_json,'$.occurrences') entry,
        json_each(entry.value,'$.speakers') credit
      JOIN event_agenda_occurrence_speakers assigned
        ON assigned.occurrence_id=json_extract(entry.value,'$.id') AND assigned.user_id=json_extract(credit.value,'$.userId')
      JOIN event_agenda_occurrences occurrence ON occurrence.id=assigned.occurrence_id AND occurrence.event_id=publication.event_id
      JOIN users person ON person.id=assigned.user_id
      WHERE publication.event_id=${event.sql} AND publication.revision=${revision.sql}
        AND json_extract(entry.value,'$.visibility')='public' AND json_extract(entry.value,'$.kind')<>'break'
        AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
        ${options.day ? "AND json_extract(entry.value,'$.startAt')>=? AND json_extract(entry.value,'$.startAt')<?" : ""}`,
    bindings: [
      ...event.bindings,
      ...revision.bindings,
      ...(options.day ? [options.day.startsFrom, options.day.startsBefore] : []),
    ],
  };
}
