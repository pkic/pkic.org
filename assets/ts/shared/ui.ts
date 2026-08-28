export type ToastType = "success" | "error" | "info";

export function showToast(targetId: string, message: string, type: ToastType = "info"): void {
  const element = document.createElement("div");
  const alertClass = { success: "alert-success", error: "alert-danger", info: "alert-info" }[type];
  element.className = `my-toast alert ${alertClass}`;
  element.textContent = message;
  document.getElementById(targetId)?.appendChild(element);
  setTimeout(() => element.remove(), 5000);
}

/** Format a date string to a short US English locale string, or an em dash. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
}

/** Escape a value before inserting it into an intentionally generated HTML or SVG string. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
