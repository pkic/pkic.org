/**
 * Check-in links: the absolute link a code carries, and the code read back
 * from whatever a camera decoded. Only a link to a portal check-in page
 * yields a code; the app never follows a decoded link anywhere else.
 */
import { slugPattern } from "../../../shared/schemas/api-common";
import { attendancePointTokenSchema } from "../../../shared/schemas/event-attendance-points";

export function attendancePointUrl(path: string, origin: string = window.location.origin): string {
  return new URL(path, origin).toString();
}

const CHECK_IN_ROUTE = /^#\/events\/([^/?#]+)\/check-in\/([^/?#]+)$/;

/** The event slug and code in a scanned check-in link, or null for anything else. */
export function scannedAttendancePoint(raw: string): { eventSlug: string; token: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.pathname !== "/portal/" && url.pathname !== "/portal") return null;
  const match = CHECK_IN_ROUTE.exec(url.hash);
  if (!match) return null;
  const token = attendancePointTokenSchema.safeParse(match[2]);
  let eventSlug: string;
  try {
    eventSlug = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  return token.success && slugPattern.test(eventSlug) ? { eventSlug, token: token.data } : null;
}
