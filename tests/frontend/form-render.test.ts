// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../../assets/ts/shared/widgets/consents";
import { renderCustomFields, readCustomFieldValues } from "../../assets/ts/shared/widgets/custom-fields";
import { findFieldErrorTarget } from "../../assets/ts/shared/form/validation-map";
import { installLiveValidation } from "../../assets/ts/shared/form/validation";
import { controlFor } from "./helpers/labelled-control";

const option = (value: string) => ({ value, label: value, active: true });

describe("frontend field rendering", () => {
  it("renders display text for terms and serializes accepted consent values", () => {
    const host = document.createElement("div");
    renderConsentInputs(host, [
      {
        termKey: "privacy",
        version: "v1",
        required: true,
        contentRef: "/privacy",
        displayText: "I have read and accept the privacy policy.",
      },
    ]);

    // Resolved through the `for`/`id` pair rather than a class, so the lookup
    // fails exactly when the label stops naming the control.
    const consent = controlFor(host, "I have read and accept the privacy policy.");
    expect(consent.type).toBe("checkbox");
    expect(consent.required).toBe(true);

    const link = host.querySelector<HTMLAnchorElement>("a[aria-label^='Read:']");
    expect(link?.getAttribute("href")).toBe("/privacy");

    const form = document.createElement("form");
    form.append(host);

    const checkboxes = host.querySelectorAll<HTMLInputElement>("input[name='consents']");
    checkboxes[0].checked = true;

    expect(readConsentValues(form)).toEqual([{ termKey: "privacy", version: "v1" }]);
  });

  it("marks a required term that has not been agreed to when the flow validates the form", () => {
    const form = document.createElement("form");
    document.body.append(form);
    const host = document.createElement("div");
    form.append(host);
    // Through `act`, so the card's effects — the one that listens for the
    // platform's `invalid` event — have run before the form is validated.
    void act(() => {
      renderConsentInputs(host, [
        { termKey: "privacy", version: "v1", required: true, contentRef: null, displayText: "Privacy policy" },
      ]);
    });

    expect(host.querySelector('[role="alert"]')).toBeNull();

    // This used to reach into the card and toggle Bootstrap's `is-invalid`.
    // It now asks the control to re-check itself, and the card takes its
    // message from the platform's `invalid` event.
    void act(() => {
      syncConsentValidation(form);
    });

    const consent = controlFor(host, "Privacy policy");
    expect(consent.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("You need to agree");
    form.remove();
  });

  it("renders custom widgets and serializes values", () => {
    const host = document.createElement("div");
    renderCustomFields(host, [
      {
        key: "interests",
        label: "Interests",
        fieldType: "multi_select",
        required: false,
        sortOrder: 1,
        optionSource: null,
        options: [option("PKI"), option("PQC")],
        validation: { uiWidget: "tags", allowCustom: true },
      },
      {
        key: "dietary",
        label: "Dietary",
        fieldType: "multi_select",
        required: false,
        sortOrder: 2,
        optionSource: null,
        options: [option("Vegan"), option("Halal")],
        validation: { uiWidget: "checkboxes" },
      },
      {
        key: "nps",
        label: "NPS",
        fieldType: "number",
        required: false,
        sortOrder: 3,
        optionSource: null,
        options: [],
        validation: { uiWidget: "nps" },
      },
      {
        key: "availability",
        label: "Availability",
        fieldType: "text",
        required: false,
        sortOrder: 4,
        optionSource: null,
        options: [],
        validation: { format: "date_range" },
      },
    ]);

    const form = document.createElement("form");
    form.append(host);

    const tagInput = host.querySelector<HTMLInputElement>("input[name='custom.interests'][data-custom-widget='tags']");
    const dietary = host.querySelector<HTMLInputElement>("input[name='custom.dietary[]'][value='Vegan']");
    const npsButton = host.querySelector<HTMLButtonElement>("button[data-value='9']");
    const start = host.querySelector<HTMLInputElement>("input[name='custom.availability.start']");
    const end = host.querySelector<HTMLInputElement>("input[name='custom.availability.end']");

    if (!tagInput || !dietary || !npsButton || !start || !end) {
      throw new Error("expected rendered widgets");
    }

    tagInput.value = JSON.stringify(["PKI", "Migration"]);
    dietary.checked = true;
    npsButton.click();
    start.value = "2026-12-01";
    end.value = "2026-12-03";

    const values = readCustomFieldValues(form);
    expect(values.interests).toEqual(["PKI", "Migration"]);
    expect(values.dietary).toEqual(["Vegan"]);
    expect(values.nps).toBe(9);
    expect(values.availability).toEqual({ start: "2026-12-01", end: "2026-12-03" });

    const interestsError = host.querySelector<HTMLElement>("[data-field-error='interests']");
    const dietaryError = host.querySelector<HTMLElement>("[data-field-error='dietary']");
    const npsError = host.querySelector<HTMLElement>("[data-field-error='nps']");
    expect(interestsError).toBeTruthy();
    expect(dietaryError).toBeTruthy();
    expect(npsError).toBeTruthy();
  });

  it("hides conditional questions when attendance conditions are not met", () => {
    const host = document.createElement("div");
    const controller = renderCustomFields(host, [
      {
        key: "dietary_restrictions",
        label: "Dietary restrictions",
        fieldType: "multi_select",
        required: false,
        sortOrder: 1,
        optionSource: null,
        options: [option("Vegetarian")],
        validation: { showWhen: { dayAttendanceIn: ["in_person"] } },
      },
    ]);

    const row = host.querySelector<HTMLElement>("[data-custom-field-key='dietary_restrictions']");
    const field = host.querySelector<HTMLInputElement>("input[name='custom.dietary_restrictions']");
    if (!row || !field) {
      throw new Error("expected rendered field");
    }

    controller.updateVisibility({
      dayAttendance: [{ attendanceType: "virtual" }],
      eventAttendanceType: "virtual",
    });
    expect(row.classList.contains("visually-hidden")).toBe(true);
    expect(field.disabled).toBe(true);

    controller.updateVisibility({
      dayAttendance: [{ attendanceType: "in_person" }],
      eventAttendanceType: "in_person",
    });
    expect(row.classList.contains("visually-hidden")).toBe(false);
    expect(field.disabled).toBe(false);
  });

  it("maps native field names to namespaced error targets", () => {
    const form = document.createElement("form");
    const error = document.createElement("div");
    error.dataset.fieldError = "proposer.email";
    form.append(error);

    const target = findFieldErrorTarget(form, "email");
    expect(target).toBe(error);
  });

  it("shows live error for incomplete email domains", () => {
    const form = document.createElement("form");
    const status = document.createElement("p");
    status.dataset.flowStatus = "";

    const email = document.createElement("input");
    email.type = "email";
    email.name = "email";
    const emailError = document.createElement("div");
    emailError.dataset.fieldError = "email";

    form.append(email, emailError, status);
    installLiveValidation(form, status);

    email.value = "paul@vanbrouc";
    email.dispatchEvent(new Event("input", { bubbles: true }));

    expect(email.validationMessage).toContain("valid email address");
    expect(emailError.textContent).toContain("valid email address");
  });

  it("does not clear a business-rule email error on change or blur", () => {
    const form = document.createElement("form");
    const status = document.createElement("p");
    const email = document.createElement("input");
    email.type = "email";
    email.name = "email";
    email.value = "person@gmail.com";
    const emailError = document.createElement("div");
    emailError.dataset.fieldError = "email";
    form.append(email, emailError, status);
    installLiveValidation(form, status);

    email.setCustomValidity("Use an organization email address.");
    email.dispatchEvent(new Event("change", { bubbles: true }));
    email.dispatchEvent(new Event("blur", { bubbles: false }));

    expect(email.validationMessage).toBe("Use an organization email address.");
    expect(emailError.textContent).toBe("Use an organization email address.");
  });
});
