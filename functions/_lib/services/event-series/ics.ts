import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { buildLiveAccessibleGroupResourceIdsCte, type GroupResourceViewer } from "../resource-grants";
import { liveEventResourceContextAccess } from "./read-access";

interface CalendarOccurrenceRow {
  event_name: string;
  id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: "scheduled" | "cancelled" | "completed" | null;
  location: string | null;
  updated_at: string | null;
}

interface CalendarGroupContext {
  id: string;
  slug: string;
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function utcTimestamp(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function fold(line: string): string {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  chunks.push(remaining);
  return chunks.join("\r\n");
}

export async function generateGroupSeriesIcs(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  throughGroup: CalendarGroupContext,
  seriesId: string,
  baseUrl: string,
): Promise<string> {
  const access = liveEventResourceContextAccess(viewer, throughGroup.id);
  const accessibleEvents = buildLiveAccessibleGroupResourceIdsCte("event", throughGroup.id, access, "view");
  const rows = await all<CalendarOccurrenceRow>(
    db,
    `WITH ${accessibleEvents.sql}
     SELECT event.name AS event_name, occurrence.id, occurrence.starts_at, occurrence.ends_at, occurrence.status,
            COALESCE(occurrence.location_override, series.location) AS location,
            occurrence.updated_at
       FROM accessible_resource accessible
       JOIN events event ON event.id = accessible.resource_id
       JOIN event_series series ON series.event_id = event.id
       CROSS JOIN group_access
  LEFT JOIN event_occurrences occurrence ON occurrence.series_id = series.id
        AND occurrence.starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
      WHERE series.id = ? AND (group_access.manager_access = 1 OR series.active = 1)
      ORDER BY occurrence.starts_at, occurrence.id
      LIMIT 500`,
    [...accessibleEvents.bindings, seriesId],
  );
  if (rows.length === 0) {
    throw new AppError(404, "EVENT_SERIES_NOT_FOUND", "Meeting series is not available through this group");
  }
  const eventName = rows[0].event_name;
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PKI Consortium//Group Meetings//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcs(eventName)}`,
  ];
  for (const occurrence of rows) {
    if (
      !occurrence.id ||
      !occurrence.starts_at ||
      !occurrence.ends_at ||
      !occurrence.status ||
      !occurrence.updated_at
    ) {
      continue;
    }
    const joinUrl = `${normalizedBaseUrl}/meetings/join/?occurrence=${encodeURIComponent(occurrence.id)}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${occurrence.id}@pkic.org`,
      `DTSTAMP:${utcTimestamp(occurrence.updated_at)}`,
      `DTSTART:${utcTimestamp(occurrence.starts_at)}`,
      `DTEND:${utcTimestamp(occurrence.ends_at)}`,
      `SUMMARY:${escapeIcs(eventName)}`,
      `URL:${escapeIcs(joinUrl)}`,
    );
    if (occurrence.location) lines.push(`LOCATION:${escapeIcs(occurrence.location)}`);
    if (occurrence.status === "cancelled") lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
