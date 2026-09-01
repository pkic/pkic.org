/**
 * The "is this address right?" card on the registration form's review step.
 *
 * It is a required checkbox wearing a card: the input carries the semantics
 * and the card carries the appearance, plus `role="checkbox"` so that the
 * whole card is one control rather than a box with decoration around it.
 *
 * Its checked and invalid states are ARIA attributes, not classes. The version
 * this replaces toggled Bootstrap's `is-invalid` from
 * `form.classList.contains("was-validated")` — a second copy of validation
 * state that only the legacy stylesheet knew how to draw, and one that the
 * submit path set *after* this module had already painted the card, so an
 * unchecked box stayed unmarked until the next change event.
 */

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

  card.classList.toggle("is-checked", confirmation.checked);
  card.setAttribute("aria-checked", String(confirmation.checked));
  // Checking the box clears the error; setting it is the `invalid` listener's
  // job, below. The state lives on the attribute a screen reader reads, so the
  // card now announces that it is invalid instead of only looking it.
  if (confirmation.checked) card.removeAttribute("aria-invalid");
}

export function installEmailReviewCard(form: HTMLFormElement): void {
  const review = findEmailReviewCard(form);
  if (!review) return;
  const { confirmation, card } = review;

  const toggle = (): void => {
    confirmation.checked = !confirmation.checked;
    confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    syncEmailReviewCard(form);
  };

  card.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("label, input")) return;
    toggle();
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    toggle();
  });
  confirmation.addEventListener("change", () => syncEmailReviewCard(form));
  // The platform fires `invalid` on a required control that fails, which is
  // exactly the moment the card should turn red — and it fires inside the
  // `checkValidity()` that `validateBeforeSubmit` runs.
  confirmation.addEventListener("invalid", () => card.setAttribute("aria-invalid", "true"));
  syncEmailReviewCard(form);
}
