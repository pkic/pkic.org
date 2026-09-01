/*
 * The toast is built imperatively rather than rendered, because the callers
 * are a mix of Preact components and plain modules that only have a container
 * id. It therefore writes the design system's class names itself, which means
 * it must import their stylesheet: component CSS ships in a lazy chunk, so a
 * class whose sheet nothing imported renders unstyled.
 */
import "../ui/Toast.css";

export type ToastType = "success" | "error" | "info";

/**
 * The tone modifier for each outcome. A full class name per entry, not a
 * suffix interpolated into `pk-toast--${...}`, so every `pk-` class in this
 * module is one a stylesheet actually defines.
 */
const TOAST_TONE_CLASS: Record<ToastType, string> = {
  success: "pk-toast--ok",
  error: "pk-toast--danger",
  info: "pk-toast--info",
};

export function showToast(targetId: string, message: string, type: ToastType = "info"): void {
  const element = document.createElement("div");
  // `my-toast` stays: the container's fixed positioning still comes from the
  // portal stylesheet, and the end-to-end specs locate toasts by it.
  element.className = `my-toast pk pk-toast ${TOAST_TONE_CLASS[type]}`;
  // A confirmation, not an interruption — the same role the Toast primitive
  // uses, so the outcome is announced without stealing focus.
  element.setAttribute("role", "status");

  const dot = document.createElement("span");
  dot.className = "pk-toast__dot";
  dot.setAttribute("aria-hidden", "true");

  const body = document.createElement("span");
  body.className = "pk-toast__message";
  body.textContent = message;

  element.append(dot, body);
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

/** Escape a value before inserting it into an intentionally generated HTML or SVG string. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
