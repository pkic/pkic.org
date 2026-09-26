import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import {
  buildLiveAccessibleGroupResourceIdsCte,
  liveGroupResourceContextAccess,
  type GroupResourceViewer,
} from "../resource-grants";

import { MEETING_CALENDAR_OCCURRENCE_LIMIT } from "../../../../assets/shared/meeting-calendar-policy";
import { CALENDAR_OCCURRENCE_WINDOW_SQL } from "./calendar-schedule";
import { nowIso } from "../../utils/time";
import { buildSeriesCalendarPayload, type SeriesCalendar, type SeriesCalendarOccurrence } from "./series-calendar";
import { buildOccurrenceInviteIcs } from "./invite-calendar";
import { occurrenceJoinUrl } from "./occurrence-notifications";
import { meetingCalendarFilename } from "./calendar-filename";
import { memberMeetingLinkUrl, memberMeetingLinkUrls } from "./personal-entry-links";

interface CalendarGroupContext {
  id: string;
  slug: string;
}
interface CalendarRow extends SeriesCalendar {
  active: number;
  occurrence_id: string | null;
  occurrence_starts_at: string | null;
  recurrence_id: string | null;
  ends_at: string | null;
  status: string | null;
  occurrence_location: string | null;
  calendar_sequence: number | null;
}

export async function generateGroupSeriesIcs(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  throughGroup: CalendarGroupContext,
  seriesId: string,
  baseUrl: string,
  occurrenceId?: string,
  personal?: { userId: string; attendeeEmail: string; organizerEmail: string; signingSecret: string },
): Promise<{ content: string; filename: string }> {
  if (personal) {
    const eligible = await first<{ allowed: number }>(
      db,
      `SELECT 1 AS allowed FROM current_event_occurrence_subject_eligibility eligibility
       JOIN event_occurrences occurrence ON occurrence.id = eligibility.occurrence_id
       WHERE eligibility.user_id = ? AND occurrence.series_id = ? LIMIT 1`,
      [personal.userId, seriesId],
    );
    if (!eligible) throw new AppError(403, "MEETING_ACCESS_REVOKED", "You are not eligible for this meeting series");
  }
  const access = liveGroupResourceContextAccess(viewer, throughGroup.id);
  const accessibleEvents = buildLiveAccessibleGroupResourceIdsCte("event", throughGroup.id, access, "view");
  const rows = await all<CalendarRow>(
    db,
    `WITH ${accessibleEvents.sql}
     SELECT series.id, series.event_id, event.owner_group_id, owner.slug AS owner_group_slug, event.name AS event_name,
            series.starts_at, series.recurrence_rule, series.duration_minutes, series.timezone,
            series.location, series.calendar_revision, series.calendar_through, series.active,
            occurrence.id AS occurrence_id, occurrence.starts_at AS occurrence_starts_at,
            COALESCE(occurrence.recurrence_id, occurrence.starts_at) AS recurrence_id,
            occurrence.ends_at, occurrence.status, occurrence.calendar_sequence,
            COALESCE(occurrence.location_override, series.location) AS occurrence_location
       FROM accessible_resource accessible
       JOIN events event ON event.id = accessible.resource_id
       JOIN groups owner ON owner.id = event.owner_group_id
       JOIN event_series series ON series.event_id = event.id
       CROSS JOIN group_access
  LEFT JOIN event_occurrences occurrence ON occurrence.series_id = series.id
        AND ${occurrenceId ? "occurrence.id = ?" : CALENDAR_OCCURRENCE_WINDOW_SQL}
      WHERE series.id = ? AND (group_access.manager_access = 1 OR series.active = 1)
      ORDER BY occurrence.starts_at, occurrence.id
      LIMIT ?`,
    [
      ...accessibleEvents.bindings,
      occurrenceId ?? new Date(Date.now() - 30 * 86400_000).toISOString(),
      seriesId,
      MEETING_CALENDAR_OCCURRENCE_LIMIT + 1,
    ],
  );
  if (rows.length === 0) {
    throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series is not available through this group");
  }
  if (rows.length > MEETING_CALENDAR_OCCURRENCE_LIMIT)
    throw new AppError(422, "MEETING_CALENDAR_TOO_LARGE", "The calendar exceeds the supported occurrence horizon");
  const filename = meetingCalendarFilename(rows[0].event_name, rows[0].owner_group_slug).replace(
    /\.ics$/,
    personal ? "-personal.ics" : ".ics",
  );
  let personalJoinUrl: string | undefined;
  if (personal) {
    const links = await memberMeetingLinkUrls(
      db,
      seriesId,
      occurrenceId ?? null,
      [{ userId: personal.userId, email: personal.attendeeEmail }],
      baseUrl,
      personal.signingSecret,
    );
    personalJoinUrl = memberMeetingLinkUrl(links, personal.userId, personal.attendeeEmail);
  }
  if (occurrenceId) {
    const row = rows[0];
    if (!row.occurrence_id || !row.occurrence_starts_at || !row.ends_at) {
      throw new AppError(404, "EVENT_OCCURRENCE_NOT_FOUND", "Meeting occurrence is not available in this series");
    }
    return {
      filename,
      content: buildOccurrenceInviteIcs(
        {
          occurrenceId: row.occurrence_id,
          eventId: row.event_id,
          eventName: row.event_name,
          startsAt: row.occurrence_starts_at,
          endsAt: row.ends_at,
          location: row.occurrence_location,
          joinUrl: personalJoinUrl ?? occurrenceJoinUrl(baseUrl, row.occurrence_id),
          sequence: row.calendar_sequence ?? 0,
          attendeeEmail: personal?.attendeeEmail,
          organizerEmail: personal?.organizerEmail,
        },
        personal ? (row.status === "cancelled" || row.active !== 1 ? "CANCEL" : "REQUEST") : undefined,
        row.status === "cancelled" || row.active !== 1,
      ),
    };
  }
  const occurrences: SeriesCalendarOccurrence[] = rows.flatMap((row) =>
    row.occurrence_id && row.occurrence_starts_at && row.recurrence_id && row.ends_at && row.status
      ? [
          {
            id: row.occurrence_id,
            starts_at: row.occurrence_starts_at,
            recurrence_id: row.recurrence_id,
            ends_at: row.ends_at,
            status: row.status,
            location: row.occurrence_location,
          },
        ]
      : [],
  );
  return {
    filename,
    content: buildSeriesCalendarPayload(rows[0], occurrences, {
      baseUrl,
      cancelled: rows[0].active !== 1,
      now: nowIso(),
      published: !personal,
      attendeeEmail: personal?.attendeeEmail,
      joinUrl: personalJoinUrl,
      organizerEmail: personal?.organizerEmail,
    }).inlineContent!,
  };
}
