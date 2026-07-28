/**
 * Small portal-local UI helpers. Deliberately duplicates admin/ui.ts's
 * toast()/fmt() rather than sharing a module — matches this codebase's
 * existing precedent of small duplicated client-side helpers across the
 * admin/portal SPA boundary (see prd.md "§2.4 / §3.5 Admin Portal UI"
 * decision 5).
 */

export type ToastType = "success" | "error" | "info";

export function toast(message: string, type: ToastType = "info"): void {
  const el = document.createElement("div");
  const cls = { success: "alert-success", error: "alert-danger", info: "alert-info" }[type];
  el.className = `my-toast alert ${cls}`;
  el.textContent = message;
  document.getElementById("portal-toast-area")?.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Format a date string to a short locale string, or "—" for null/empty. */
export function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

/** "in_review" -> "In Review" */
export function formatStageLabel(stage: string): string {
  return stage
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
