/** Organizer-facing names for check-in codes, and the links that download them. */
import { ATTENDANCE_POINT_KINDS } from "../../../shared/attendance-points";
import {
  attendancePointExportQuerySchema,
  type AttendancePoint,
} from "../../../shared/schemas/event-attendance-points";

export const ATTENDANCE_POINT_KIND_LABELS: Record<AttendancePoint["kind"], string> = {
  venue_check_in: "Venue check-in",
  venue_check_out: "Venue check-out",
  room: "Room",
  session: "Session",
};

/** The kind filter: venue and room codes by default, session codes on request. */
export const ATTENDANCE_POINT_KIND_FILTER = [
  { value: "", label: "Venue and room codes" },
  ...ATTENDANCE_POINT_KINDS.map((kind) => ({ value: kind, label: ATTENDANCE_POINT_KIND_LABELS[kind] })),
];

/** Where a code is used: the day for venue codes, the room for room and session codes. */
export function attendancePointPlace(point: AttendancePoint): string {
  if (point.kind === "venue_check_in" || point.kind === "venue_check_out") return point.dayLabel ?? "";
  if (point.kind === "room") return "Every session in this room";
  return point.session?.room?.name ?? "";
}

/** The selection a code's own page is addressed by: its kind and the day, room or session it is for. */
export function attendancePointTarget(point: AttendancePoint): string {
  if (point.kind === "room") return point.room!.id;
  if (point.kind === "session") return point.session!.id;
  return point.dayDate!;
}

/** The listing filter that selects exactly one code again. */
export function attendancePointFilter(kind: string, target: string): Record<string, string> | null {
  if (kind === "venue_check_in" || kind === "venue_check_out") return { kind, dayDate: target };
  if (kind === "room") return { kind, roomId: target };
  if (kind === "session") return { kind, occurrenceId: target };
  return null;
}

/**
 * The link that downloads codes as SVG: one code (`svg`) or every code a
 * listing filter selects (`zip`). Only the export contract's filters pass.
 */
export function attendancePointDownloadHref(
  slug: string,
  format: "svg" | "zip",
  filter: Readonly<Record<string, string>>,
): string {
  const query = attendancePointExportQuerySchema.parse({
    ...Object.fromEntries(Object.entries(filter).filter(([key, value]) => key !== "format" && value)),
    format,
  });
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined) as string[][]);
  return `/api/v1/events/${encodeURIComponent(slug)}/attendance/points/exports?${params}`;
}

/** The download link for one listed code. */
export function attendancePointSvgHref(slug: string, point: AttendancePoint): string {
  return attendancePointDownloadHref(slug, "svg", attendancePointFilter(point.kind, attendancePointTarget(point))!);
}
