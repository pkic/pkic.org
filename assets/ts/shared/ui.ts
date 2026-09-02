export type ToastType = "success" | "error" | "info";

export function showToast(targetId: string, message: string, type: ToastType = "info"): void {
  const element = document.createElement("div");
  const alertClass = { success: "alert-success", error: "alert-danger", info: "alert-info" }[type];
  element.className = `my-toast alert ${alertClass}`;
  element.textContent = message;
  document.getElementById(targetId)?.appendChild(element);
  setTimeout(() => element.remove(), 5000);
}

/** Format an instant in the viewer's own locale, or an em dash. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

/** Format an instant as a date only (no time of day) in the viewer's own locale, or an em dash. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium" });
}

/**
 * A friendly calendar span in the viewer's locale — "1–3 December 2026" style,
 * collapsing to a single date when the range covers one day. Dates render in
 * the owning event's zone when one is given, per the wall-clock rule.
 */
export function formatDateRange(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  timeZone?: string | null,
): string {
  if (!startsAt) return "—";
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  };
  const formatter = new Intl.DateTimeFormat(undefined, options);
  const start = new Date(startsAt);
  if (!endsAt) return formatter.format(start);
  try {
    return formatter.formatRange(start, new Date(endsAt));
  } catch {
    return formatter.format(start);
  }
}

/**
 * An instant on the wall clock of a specific IANA zone, with the zone named
 * so the reader cannot mistake it for their own — "Dec 1, 2026, 9:00 AM CET".
 */
export function formatDateTimeInZone(value: string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
}

/**
 * Display policy for event times. The viewer's own registration is the
 * authoritative signal: attending in person shows the venue's clock with its
 * zone named, attending virtually or on demand shows the viewer's local
 * time. Without a registration, a physical venue implies the venue's clock;
 * everything else (and deadlines) stays local.
 */
export function formatEventWhen(
  startsAt: string | null | undefined,
  timeZone: string | null | undefined,
  location: string | null | undefined,
  attendanceType?: "in_person" | "virtual" | "on_demand" | null,
): string {
  if (attendanceType === "in_person" && timeZone) return formatDateTimeInZone(startsAt, timeZone);
  if (attendanceType) return formatDateTime(startsAt);
  if (location && timeZone) return formatDateTimeInZone(startsAt, timeZone);
  return formatDateTime(startsAt);
}

/** "today", "tomorrow", "in 95 days" — null when the instant is past or unknown. */
export function formatRelativeDays(instant: string | null | undefined): string | null {
  if (!instant) return null;
  const millis = new Date(instant).getTime() - Date.now();
  if (!Number.isFinite(millis)) return null;
  const days = Math.round(millis / 86_400_000);
  if (days < 0) return null;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(days, "day");
}

/**
 * A service date. Seats and leadership terms are stored as UTC instants that
 * stand for a calendar date (a manager picks "1 June 2022", stored as that
 * day's midnight UTC), so the UTC date is the meaning and rendering it in the
 * viewer's zone would shift it by a day west of Greenwich.
 */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

/** "Jun 2022" in UTC, for public tenure lines that read as month and year. */
export function formatCalendarMonth(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

/** The `YYYY-MM-DD` a date input shows for a stored service instant. */
export function toCalendarDateInput(instant: string | null | undefined): string {
  return instant ? instant.slice(0, 10) : "";
}

/** The UTC instant a picked `YYYY-MM-DD` service date is stored as; empty input yields null. */
export function fromCalendarDateInput(date: string): string | null {
  return date ? `${date}T00:00:00.000Z` : null;
}

/** Escape a value before inserting it into an intentionally generated HTML or SVG string. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
