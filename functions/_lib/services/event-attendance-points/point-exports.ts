/**
 * Check-in codes as SVG files for organizers to place in their own poster
 * designs: one code, or every code a listing filter selects as a ZIP with one
 * SVG per code. Each SVG holds only the QR code (with its quiet zone) of the
 * static, printable code; its name is in the file name and the SVG title.
 */
import { downloadZip } from "client-zip";
import { qrModulePath } from "../../../../assets/shared/qr-modules";
import { slugifyOr } from "../../../../assets/shared/slug";
import {
  attendancePointExportQuerySchema,
  type AttendancePoint,
} from "../../../../assets/shared/schemas/event-attendance-points";
import { MAX_PAGE_LIMIT } from "../../../../assets/shared/schemas/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import type { EventRecord } from "../event-types";
import { listAttendancePoints } from "./point-catalog";

/** At most this many codes download together; a larger set is downloaded by type or day. */
export const MAX_EXPORTED_POINTS = 1_000;
/** Each QR module is this many SVG user units, so tools that ignore the viewBox still get a usable size. */
const MODULE_UNITS = 10;
const ARCHIVE_DATE = new Date("2020-01-01T00:00:00.000Z");

const xml = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

export function attendancePointSvg(point: Pick<AttendancePoint, "label" | "path">, origin: string): string {
  const qr = qrModulePath(new URL(point.path, origin).toString());
  const size = qr.size * MODULE_UNITS;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size} ${qr.size}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img"><title>${xml(`Check-in code: ${point.label}`)}</title><rect width="${qr.size}" height="${qr.size}" fill="#fff"/><path d="${qr.path}" fill="#000"/></svg>
`;
}

/** Readable, unique ASCII file names: "day-1-check-in.svg", "main-hall.svg", "opening-keynote-2.svg". */
function fileNames(points: readonly AttendancePoint[]): string[] {
  const used = new Map<string, number>();
  return points.map((point) => {
    const base = slugifyOr(point.label, "check-in-code", { maxLength: 80 });
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return `${seen === 1 ? base : `${base}-${seen}`}.svg`;
  });
}

async function selectedPoints(db: DatabaseLike, signingSecret: string, event: EventRecord, filter: object) {
  const points: AttendancePoint[] = [];
  for (let offset = 0; offset < MAX_EXPORTED_POINTS; offset += MAX_PAGE_LIMIT) {
    const page = await listAttendancePoints(
      db,
      signingSecret,
      event,
      { ...filter, limit: String(MAX_PAGE_LIMIT), offset: String(offset) },
      false,
    );
    if (page.page.total > MAX_EXPORTED_POINTS)
      throw new AppError(413, "ATTENDANCE_POINT_EXPORT_TOO_LARGE", "Too many codes at once. Download them by type.");
    points.push(...page.points);
    if (!page.page.hasMore) break;
  }
  return points;
}

export async function exportAttendancePoints(
  db: DatabaseLike,
  signingSecret: string,
  event: EventRecord,
  raw: unknown,
  origin: string,
): Promise<Response> {
  const { format, ...filter } = attendancePointExportQuerySchema.parse(raw);
  const points = await selectedPoints(db, signingSecret, event, filter);
  const headers = { "Cache-Control": "no-store" };
  if (format === "svg") {
    const [point] = points;
    if (!point || points.length !== 1)
      throw new AppError(400, "ATTENDANCE_POINT_EXPORT_NOT_ONE", "Choose one check-in code to download as SVG.");
    return new Response(attendancePointSvg(point, origin), {
      headers: {
        ...headers,
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileNames(points)[0]}"`,
      },
    });
  }
  if (!points.length)
    throw new AppError(404, "ATTENDANCE_POINTS_NOT_FOUND", "There are no check-in codes to download.");
  const names = fileNames(points);
  const archive = downloadZip(
    points.map((point, index) => ({
      name: names[index]!,
      input: attendancePointSvg(point, origin),
      lastModified: ARCHIVE_DATE,
    })),
    { buffersAreUTF8: true },
  );
  return new Response(archive.body, {
    headers: {
      ...headers,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slugifyOr(event.slug, "event", { maxLength: 80 })}-check-in-codes.zip"`,
    },
  });
}
