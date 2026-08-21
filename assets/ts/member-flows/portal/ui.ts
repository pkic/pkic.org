import { formatDateTime, showToast, type ToastType } from "../../shared/ui";
import { formatStatusLabel } from "../../shared/form/helpers";
export type { ToastType } from "../../shared/ui";

export function toast(message: string, type: ToastType = "info"): void {
  showToast("portal-toast-area", message, type);
}

/** Format a date string to a short locale string, or "—" for null/empty. */
export function fmt(value: string | null | undefined): string {
  return formatDateTime(value);
}

/** "in_review" -> "In Review" */
export function formatStageLabel(stage: string): string {
  return formatStatusLabel(stage);
}

export function stageBadgeClass(stage: string): string {
  switch (stage) {
    case "approved":
      return "text-bg-success";
    case "declined":
    case "withdrawn":
      return "text-bg-danger";
    case "on_hold":
      return "text-bg-warning";
    case "in_review":
    case "in_consultation":
    case "ec_review":
      return "text-bg-info";
    default:
      return "text-bg-secondary";
  }
}
