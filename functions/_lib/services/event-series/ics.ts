import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { getGroup } from "../groups";
import { getGroupEventSeries } from "./series";

interface CalendarOccurrenceRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "cancelled" | "completed";
  location: string | null;
  updated_at: string;
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
  groupIdOrSlug: string,
  seriesId: string,
  baseUrl: string,
): Promise<string> {
  const [series, group] = await Promise.all([
    getGroupEventSeries(db, groupIdOrSlug, seriesId),
    getGroup(db, groupIdOrSlug),
  ]);
  const occurrences = await all<CalendarOccurrenceRow>(
    db,
    `SELECT occurrence.id, occurrence.starts_at, occurrence.ends_at, occurrence.status,
            COALESCE(occurrence.location_override, series.location) AS location,
            occurrence.updated_at
       FROM event_occurrences occurrence
       JOIN event_series series ON series.id = occurrence.series_id
      WHERE occurrence.series_id = ? AND occurrence.starts_at >= datetime('now', '-30 days')
      ORDER BY occurrence.starts_at, occurrence.id
      LIMIT 500`,
    [seriesId],
  );
  const portalUrl = `${baseUrl.replace(/\/$/, "")}/portal/groups/${group?.slug ?? groupIdOrSlug}/meetings`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PKI Consortium//Group Meetings//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcs(series.eventName)}`,
  ];
  for (const occurrence of occurrences) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${occurrence.id}@pkic.org`,
      `DTSTAMP:${utcTimestamp(occurrence.updated_at)}`,
      `DTSTART:${utcTimestamp(occurrence.starts_at)}`,
      `DTEND:${utcTimestamp(occurrence.ends_at)}`,
      `SUMMARY:${escapeIcs(series.eventName)}`,
      `URL:${escapeIcs(portalUrl)}`,
    );
    if (occurrence.location) lines.push(`LOCATION:${escapeIcs(occurrence.location)}`);
    if (occurrence.status === "cancelled") lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
