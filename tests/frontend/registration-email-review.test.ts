// @vitest-environment jsdom
/**
 * The registration form's "is this address right?" card.
 *
 * It is a required checkbox wearing a card, with `role="checkbox"` on the
 * frame — so its state has to live on the ARIA attributes a reader hears, not
 * only in classes the legacy stylesheet draws. The version this replaces
 * painted Bootstrap's `is-invalid` from `form.classList.contains(
 * "was-validated")`, a flag the submit path set only *after* this module had
 * already run, so an unticked box stayed unmarked until the next change event.
 * These cases pin the attributes and the keyboard, neither of which a visual
 * review can check.
 */
import { afterEach, describe, expect, it } from "vitest";

import { findEmailReviewCard, installEmailReviewCard } from "../../assets/ts/event-flows/registration-email-review";

/** The card as `event-registration.html` writes it: the control and its frame. */
function emailReviewForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.noValidate = true;
  form.innerHTML =
    '<div class="event-flow-consent-card event-flow-email-review-card" data-email-review-card' +
    ' role="checkbox" aria-checked="false" tabindex="0">' +
    '<input id="registration-email-review-confirmed" name="emailReviewConfirmed" type="checkbox" required>' +
    '<label for="registration-email-review-confirmed">Yes, this address is correct</label>' +
    "</div>";
  document.body.append(form);
  return form;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("registration email-review card", () => {
  it("finds the canonical registration email-review input and card", () => {
    const form = document.createElement("form");
    form.innerHTML = '<div data-email-review-card><input type="checkbox" name="emailReviewConfirmed"></div>';
    const review = findEmailReviewCard(form);
    expect(review?.confirmation.name).toBe("emailReviewConfirmed");
    expect(review?.card.dataset.emailReviewCard).toBe("");
  });

  it("puts the email-review card's checked state on the attribute a reader hears", () => {
    const form = emailReviewForm();
    installEmailReviewCard(form);
    const { confirmation, card } = findEmailReviewCard(form)!;

    // The card is the control — `role="checkbox"` — so its state has to be on
    // `aria-checked`, not only in a class the legacy stylesheet draws.
    expect(card.getAttribute("aria-checked")).toBe("false");
    confirmation.checked = true;
    confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    expect(card.getAttribute("aria-checked")).toBe("true");
    expect(card.classList.contains("is-checked")).toBe(true);
  });

  it("marks the email-review card invalid from the platform's own event, and clears it on agreement", () => {
    const form = emailReviewForm();
    installEmailReviewCard(form);
    const { confirmation, card } = findEmailReviewCard(form)!;

    // Nothing is invalid until it has been checked, so nothing claims to be.
    expect(card.getAttribute("aria-invalid")).toBeNull();

    // `checkValidity()` is what the submit path runs; it fires `invalid` on a
    // required control that fails. The class this replaces was painted from
    // `form.classList.contains("was-validated")`, a flag the submit path set
    // only *after* the card had already been drawn — so an unticked box stayed
    // unmarked until the reader touched something else.
    expect(form.checkValidity()).toBe(false);
    expect(card.getAttribute("aria-invalid")).toBe("true");

    confirmation.checked = true;
    confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    expect(card.getAttribute("aria-invalid")).toBeNull();
    expect(form.checkValidity()).toBe(true);
  });

  it("toggles the email-review card from the keyboard, not only from a mouse", () => {
    const form = emailReviewForm();
    installEmailReviewCard(form);
    const { confirmation, card } = findEmailReviewCard(form)!;

    // The card carries `role="checkbox"` and `tabindex`, so Space and Enter
    // have to do what a click does or the control is mouse-only.
    card.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(confirmation.checked).toBe(true);
    expect(card.getAttribute("aria-checked")).toBe("true");

    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(confirmation.checked).toBe(false);
    expect(card.getAttribute("aria-checked")).toBe("false");
  });
});
