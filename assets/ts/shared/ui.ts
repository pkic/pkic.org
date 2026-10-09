/* The toast is re-exported here because this file is the frontend's established import point for it. */
export { showToast, type ToastType } from "./toast";

/*
 * Date rendering lives in `assets/shared/format-date.ts` so the plain-JS
 * public bundles reach the exact same helpers as the Preact surfaces;
 * re-exported here because this file is the frontend's established import
 * point for them.
 */
export {
  EMPTY_DATE,
  formatCalendarDate,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDateTimeInZone,
  formatDayAndMonth,
  formatEventWhen,
  formatMonthYear,
  formatRelativeDays,
  formatServiceDate,
  formatTimeOfDay,
} from "../../shared/format-date";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../shared/timezone";

/** The `YYYY-MM-DD` a date input shows for a stored service instant. */
export function toCalendarDateInput(instant: string | null | undefined): string {
  return instant ? instant.slice(0, 10) : "";
}

/** The UTC instant a picked `YYYY-MM-DD` service date is stored as; empty input yields null. */
export function fromCalendarDateInput(date: string): string | null {
  return date ? `${date}T00:00:00.000Z` : null;
}

/** The zone the reader's browser is set to, and UTC when it will not say. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The two halves of the only conversion between a stored instant and a
 * `datetime-local` control. Both go through the shared timezone codec, which
 * resolves a wall clock through an IANA identifier and rejects a local time
 * that does not exist in it; offset arithmetic of our own would be wrong twice
 * a year, on the days it matters most.
 */
export function localDateTimeValue(value: string | Date, timeZone = browserTimeZone()): string {
  return instantToDateTimeLocal(value, timeZone);
}

export function isoDateTimeValue(value: string, timeZone = browserTimeZone()): string {
  return dateTimeLocalToIso(value, timeZone);
}

/** Escape a value before inserting it into an intentionally generated HTML or SVG string. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
