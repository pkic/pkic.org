import { showManageLinkRecoveryForm } from "../shared/widgets/link-recovery";

export function showPostAction(
  root: HTMLElement,
  manageFormEl: HTMLElement,
  opts: { title: string; message: string; isError?: boolean },
): void {
  manageFormEl.classList.add("d-none");
  const postAction = root.querySelector<HTMLElement>("[data-post-action]");
  const alertEl = root.querySelector<HTMLElement>("[data-post-action-alert]");
  const titleEl = root.querySelector<HTMLElement>("[data-post-action-title]");
  const msgEl = root.querySelector<HTMLElement>("[data-post-action-message]");
  if (!postAction || !alertEl || !titleEl || !msgEl) return;
  titleEl.textContent = opts.title;
  msgEl.textContent = opts.message;
  alertEl.classList.remove("alert-success", "alert-warning", "alert-danger");
  alertEl.classList.add(opts.isError ? "alert-danger" : "alert-success");
  postAction.classList.remove("d-none");
}

export function showResendManageLinkForm(
  root: HTMLElement,
  apiBase: string,
  eventSlug: string,
  introMessage?: string,
): void {
  showManageLinkRecoveryForm({
    root,
    loadingSelector: "[data-manage-loading]",
    sectionSelector: "[data-resend-manage-section]",
    buttonSelector: "[data-resend-manage-btn]",
    statusSelector: "[data-resend-manage-status]",
    emailSelector: "[data-resend-manage-email]",
    endpoint: `${apiBase}/events/${eventSlug}/registrations/resend-manage-link`,
    successMessage:
      "If the details match a registration, you will receive an email shortly. Please check your inbox (and spam folder).",
    introMessage,
  });
}

export function buildManageLinkRecoveryMessage(message: string): string {
  const detail = message.trim();
  if (!detail) {
    return "Invalid or expired management link. You can request a fresh management link below.";
  }

  if (/invalid|expired|not found/i.test(detail)) {
    return `${detail} You can request a fresh management link below.`;
  }

  return `Invalid or expired management link. ${detail} You can request a fresh management link below.`;
}
