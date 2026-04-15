export type ToastType = "success" | "error" | "info";

export function toast(message: string, type: ToastType = "info"): void {
  const el = document.createElement("div");
  const cls = { success: "alert-success", error: "alert-danger", info: "alert-info" }[type];
  el.className = `my-toast alert ${cls}`;
  el.textContent = message;
  document.getElementById("toast-area")?.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Format a date string to a short locale string, or "—" for null/empty. */
export function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

/** HTML-escape a value (for SVG/HTML string builders only). */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
