export type ToastType = "success" | "error" | "info";

export function q<T extends Element = Element>(selector: string, context: ParentNode = document): T | null {
  return context.querySelector<T>(selector);
}

export function show(element: Element | null): void {
  element?.classList.remove("d-none");
}

export function hide(element: Element | null): void {
  element?.classList.add("d-none");
}

export function toast(message: string, type: ToastType = "info"): void {
  const el = document.createElement("div");
  const cls = { success: "alert-success", error: "alert-danger", info: "alert-info" }[type];
  el.className = `my-toast alert ${cls}`;
  el.textContent = message;
  q("#toast-area")?.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

export function spinner(): string {
  return '<div class="text-center py-4"><div class="spinner-border text-success" role="status"></div></div>';
}

export function setButtonLoading(button: HTMLButtonElement): void {
  button.dataset.originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>' +
    (button.textContent?.trim() ?? "");
}

export function resetButton(button: HTMLButtonElement): void {
  const original = button.dataset.originalHtml;
  if (original !== undefined) {
    button.innerHTML = original;
    delete button.dataset.originalHtml;
  }
  button.disabled = false;
}

export function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function badge(status: string): string {
  const map: Record<string, string> = {
    registered: "success",
    pending_email_confirmation: "warning",
    waitlisted: "info",
    cancelled: "danger",
    waiting: "warning",
    offered: "info",
    sent: "primary",
    accepted: "success",
    declined: "danger",
    expired: "secondary",
    revoked: "secondary",
    queued: "primary",
    retrying: "warning",
    failed: "danger",
    sending: "primary",
    transactional: "primary",
    promotional: "info",
    active: "success",
    draft: "warning",
    pending: "warning",
    completed: "success",
    invite_only: "warning",
    invite_or_open: "primary",
    open: "success",
    submitted: "primary",
    under_review: "info",
    rejected: "danger",
    needs_work: "warning",
    withdrawn: "secondary",
    accept: "success",
    reject: "danger",
    "needs-work": "warning",
    bounced: "danger",
    tentative: "info",
    needs_action: "warning",
  };
  const labels: Record<string, string> = {
    registered: "Confirmed",
    pending_email_confirmation: "Pending confirmation",
    waitlisted: "Waitlisted",
    cancelled: "Cancelled",
    sent: "Sent",
    accepted: "Accepted",
    declined: "Declined",
    expired: "Expired",
    revoked: "Revoked",
    queued: "Queued",
    retrying: "Retrying",
    failed: "Failed",
    sending: "Sending",
    transactional: "Transactional",
    promotional: "Promotional",
    active: "Active",
    draft: "Draft",
    pending: "Pending",
    completed: "Completed",
    invite_only: "Invite only",
    invite_or_open: "Invite or open",
    open: "Open",
    submitted: "Submitted",
    under_review: "Under review",
    rejected: "Rejected",
    needs_work: "Needs work",
    withdrawn: "Withdrawn",
    accept: "Accept",
    reject: "Reject",
    "needs-work": "Needs work",
    waiting: "Waiting",
    offered: "Offered",
  };
  const label = labels[status] ?? (status || "—");
  return `<span class="badge text-bg-${map[status] ?? "secondary"}">${esc(label)}</span>`;
}

export function tbl(heads: string[], rows: string[], empty = "No data"): string {
  if (!rows.length) {
    return `<p class="text-muted text-center py-3 fst-italic small">${esc(empty)}</p>`;
  }
  return (
    '<div class="tbl-wrap"><table class="table table-sm table-hover mb-0">' +
    '<thead class="table-light"><tr>' +
    heads.map((head) => `<th>${esc(head)}</th>`).join("") +
    "</tr></thead><tbody>" +
    rows.join("") +
    "</tbody></table></div>"
  );
}
