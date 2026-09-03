import {
  formatServiceDate,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatEventWhen,
  formatRelativeDays,
  fromCalendarDateInput,
  showToast,
  toCalendarDateInput,
  type ToastType,
} from "../../shared/ui";
export type { ToastType } from "../../shared/ui";

export function toast(message: string, type: ToastType = "info"): void {
  showToast("portal-toast-area", message, type);
}

/** Format a date string to a short locale string, or "—" for null/empty. */
export function fmt(value: string | null | undefined): string {
  return formatDateTime(value);
}

/** Format a date string to a date-only locale string (no time of day), or "—" for null/empty. */
export function fmtDate(value: string | null | undefined): string {
  return formatDate(value);
}

/** A stored service date (a seat's start, a term's end) as the calendar day it stands for. */
export function fmtCalendarDate(value: string | null | undefined): string {
  return formatServiceDate(value);
}

export { formatDateRange, formatEventWhen, formatRelativeDays, fromCalendarDateInput, toCalendarDateInput };
