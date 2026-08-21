import { formatDateTime, showToast, type ToastType } from "../shared/ui";
export type { ToastType } from "../shared/ui";

export function toast(message: string, type: ToastType = "info"): void {
  showToast("toast-area", message, type);
}

/** Format a date string to a short locale string, or "—" for null/empty. */
export function fmt(value: string | null | undefined): string {
  return formatDateTime(value);
}

/** HTML-escape a value (for SVG/HTML string builders only). */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
