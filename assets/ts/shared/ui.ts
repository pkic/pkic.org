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

/*
 * Date rendering lives in `assets/shared/format-date.ts` so the plain-JS
 * public bundles reach the exact same helpers as the Preact surfaces;
 * re-exported here because this file is the frontend's established import
 * point for them.
 */
export {
  formatCalendarDate,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDateTimeInZone,
  formatEventWhen,
  formatMonthYear,
  formatRelativeDays,
} from "../../shared/format-date";

/** Escape a value before inserting it into an intentionally generated HTML or SVG string. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
