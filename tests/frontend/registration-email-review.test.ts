// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  findEmailReviewCard,
  installEmailReviewCard,
  resetEmailReviewConfirmation,
} from "../../assets/ts/event-flows/registration-email-review";

function emailReviewForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.noValidate = true;
  form.innerHTML =
    '<section class="pk-panel" data-email-review-card><div class="pk-panel__body"><label class="pk-check"><input name="emailReviewConfirmed" type="checkbox" required><span>Yes, this address is correct</span></label></div></section>';
  document.body.append(form);
  installEmailReviewCard(form);
  return form;
}
afterEach(() => {
  document.body.innerHTML = "";
});

describe("registration email confirmation", () => {
  it("uses the native checkbox for label activation and agreement", () => {
    const form = emailReviewForm();
    const { confirmation, card } = findEmailReviewCard(form)!;
    expect(confirmation.checked).toBe(false);
    card.querySelector("label")!.click();
    expect(confirmation.checked).toBe(true);
    expect(form.checkValidity()).toBe(true);
    expect(card.querySelector(".pk-panel__body--ok")).not.toBeNull();
    expect(card.hasAttribute("role")).toBe(false);
  });
  it("announces validation on the actual input and clears it on agreement", () => {
    const form = emailReviewForm();
    const { confirmation } = findEmailReviewCard(form)!;
    expect(confirmation.hasAttribute("aria-invalid")).toBe(false);
    expect(form.checkValidity()).toBe(false);
    expect(confirmation.getAttribute("aria-invalid")).toBe("true");
    confirmation.click();
    expect(confirmation.hasAttribute("aria-invalid")).toBe(false);
  });
  it("requires confirmation again after the email changes", () => {
    const form = emailReviewForm();
    const { confirmation, card } = findEmailReviewCard(form)!;
    confirmation.click();
    resetEmailReviewConfirmation(form);
    expect(confirmation.checked).toBe(false);
    expect(card.querySelector(".pk-panel__body--ok")).toBeNull();
    expect(form.checkValidity()).toBe(false);
  });
});
