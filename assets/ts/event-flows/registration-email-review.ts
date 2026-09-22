/** Synchronize the email confirmation with shared panel and native checkbox states. */
/** The form control's name. The card is found through it, not by class. */
const EMAIL_REVIEW_FIELD = "emailReviewConfirmed";

export interface EmailReviewCard {
  confirmation: HTMLInputElement;
  card: HTMLElement;
}

export function findEmailReviewCard(form: HTMLFormElement): EmailReviewCard | null {
  const confirmation = form.elements.namedItem(EMAIL_REVIEW_FIELD);
  if (!(confirmation instanceof HTMLInputElement)) return null;
  const card = confirmation.closest<HTMLElement>("[data-email-review-card]");
  return card ? { confirmation, card } : null;
}

export function resetEmailReviewConfirmation(form: HTMLFormElement): void {
  const review = findEmailReviewCard(form);
  if (!review) return;
  review.confirmation.checked = false;
  syncEmailReviewCard(form);
}

export function syncEmailReviewCard(form: HTMLFormElement): void {
  const review = findEmailReviewCard(form);
  if (!review) return;
  const { confirmation, card } = review;

  card.querySelector(".pk-panel__body")?.classList.toggle("pk-panel__body--ok", confirmation.checked);
  if (confirmation.checked) confirmation.removeAttribute("aria-invalid");
}

export function installEmailReviewCard(form: HTMLFormElement): void {
  const review = findEmailReviewCard(form);
  if (!review) return;
  const { confirmation } = review;
  confirmation.addEventListener("change", () => syncEmailReviewCard(form));
  confirmation.addEventListener("invalid", () => confirmation.setAttribute("aria-invalid", "true"));
  syncEmailReviewCard(form);
}
