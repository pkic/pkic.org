// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../../assets/ts/shared/widgets/consents";
import { renderCustomFields, readCustomFieldValues } from "../../assets/ts/shared/widgets/custom-fields";
import { findFieldErrorTarget } from "../../assets/ts/shared/form/validation-map";
import { installLiveValidation } from "../../assets/ts/shared/form/validation";
import { controlFor } from "./helpers/labelled-control";

const option = (value: string) => ({ value, label: value, active: true });

/** A minimal custom field; each case overrides only what it is about. */
const base = (key: string, label: string) => ({
  key,
  label,
  fieldType: "text" as const,
  required: false,
  sortOrder: 1,
  optionSource: null,
  options: [],
  validation: {},
});

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

  it("dresses every custom widget in the design system's control classes", () => {
    const host = document.createElement("div");
    renderCustomFields(host, [
      { ...base("agree", "Agree to the code of conduct"), fieldType: "boolean" },
      {
        ...base("track", "Preferred track"),
        fieldType: "select",
        options: [option("Standards"), option("Deployment")],
      },
      { ...base("bio", "Short biography"), fieldType: "textarea" },
      { ...base("company", "Company") },
      {
        ...base("dietary", "Dietary"),
        fieldType: "multi_select",
        options: [option("Vegan")],
        validation: { uiWidget: "checkboxes" },
      },
    ]);

    expect(host.querySelector("input[name='custom.agree']")?.className).toBe("pk-check__input");
    expect(host.querySelector("select[name='custom.track']")?.className).toBe("pk-input pk-input--select");
    expect(host.querySelector("textarea[name='custom.bio']")?.className).toBe("pk-input pk-input--textarea");
    expect(host.querySelector("input[name='custom.company']")?.className).toBe("pk-input");

    // All three parts of the check block, not just the outer one: a label
    // carrying `pk-check` alone renders the operating system's own control.
    const check = host.querySelector("label.pk-check");
    expect(check?.querySelector("input.pk-check__input")).not.toBeNull();
    expect(check?.querySelector("span.pk-check__label")?.textContent).toBe("Vegan");
  });

  it("names each set of choices as the question it answers", () => {
    const host = document.createElement("div");
    renderCustomFields(host, [
      {
        ...base("dietary", "Dietary"),
        fieldType: "multi_select",
        options: [option("Vegan"), option("Halal")],
        validation: { uiWidget: "checkboxes" },
      },
      { ...base("nps", "How likely are you to return?"), fieldType: "number", validation: { uiWidget: "nps" } },
      { ...base("availability", "Availability"), validation: { format: "date_range" } },
    ]);

    const groups = [...host.querySelectorAll('[role="group"]')].map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Dietary", "How likely are you to return?"]);

    // The two date inputs cannot share the row's label, so each names itself.
    expect(host.querySelector("input[name='custom.availability.start']")?.getAttribute("aria-label")).toBe(
      "Availability — start date",
    );
    expect(host.querySelector("input[name='custom.availability.end']")?.getAttribute("aria-label")).toBe(
      "Availability — end date",
    );
  });

  it("states the chosen rating rather than leaving it to the fill", () => {
    const host = document.createElement("div");
    renderCustomFields(host, [{ ...base("nps", "NPS"), fieldType: "number", validation: { uiWidget: "nps" } }]);

    const scores = [...host.querySelectorAll<HTMLButtonElement>("button[data-value]")];
    expect(scores.every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
    for (const button of scores) expect(button.className).toBe("pk-btn pk-btn--sm pk-btn--secondary");

    const nine = scores.find((button) => button.dataset.value === "9");
    nine?.click();

    expect(nine?.getAttribute("aria-pressed")).toBe("true");
    expect(nine?.classList.contains("pk-btn--primary")).toBe(true);
    expect(nine?.classList.contains("pk-btn--secondary")).toBe(false);
    expect(scores.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("refuses a tag outside the suggested list and says why on the control", () => {
    const host = document.createElement("div");
    renderCustomFields(host, [
      {
        ...base("interests", "Interests"),
        fieldType: "multi_select",
        options: [option("PKI")],
        validation: { uiWidget: "tags", allowCustom: false },
      },
    ]);

    // The row's label points at the text box, which is the only control a
    // reader can actually type into.
    const label = [...host.querySelectorAll("label")].find((candidate) => candidate.htmlFor === "custom-interests");
    const text = host.querySelector<HTMLInputElement>("#custom-interests");
    expect(label?.textContent).toBe("Interests");
    expect(text?.className).toBe("pk-input");
    if (!text) throw new Error("no tag text input");

    text.reportValidity = () => true;
    void act(() => {
      text.value = "Something else";
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const add = [...host.querySelectorAll("button")].find((button) => button.textContent === "Add");
    void act(() => {
      add?.click();
    });

    expect(text.validationMessage).toBe("Please select a value from the suggested list.");
    expect(host.querySelectorAll(".event-flow-tag-pill")).toHaveLength(0);
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
    // `pk-sr-only` is the design system's visually-hidden pattern, which is
    // what `visually-hidden` was doing here.
    expect(row.classList.contains("pk-sr-only")).toBe(true);
    expect(row.getAttribute("aria-hidden")).toBe("true");
    expect(field.disabled).toBe(true);

    controller.updateVisibility({
      dayAttendance: [{ attendanceType: "in_person" }],
      eventAttendanceType: "in_person",
    });
    expect(row.classList.contains("pk-sr-only")).toBe(false);
    expect(row.getAttribute("aria-hidden")).toBe("false");
    expect(field.disabled).toBe(false);

    // The help, the reference link and the error slot are tied to the control
    // rather than merely sitting beside it, so a screen reader reaches all
    // three. The error slot is named even before a validator writes into it.
    expect(field.getAttribute("aria-describedby")).toBe("custom-dietary_restrictions-error");
    const errorSlot = host.querySelector<HTMLElement>("#custom-dietary_restrictions-error")!;
    expect(errorSlot.getAttribute("aria-live")).toBe("polite");
    expect(errorSlot.dataset.fieldError).toBe("dietary_restrictions");

    // A validator's message for a question that then becomes irrelevant is
    // cleared with the answer, so a hidden field cannot keep asserting an
    // error against a value nobody can see or correct.
    errorSlot.textContent = "Please choose at least one.";
    controller.updateVisibility({
      dayAttendance: [{ attendanceType: "virtual" }],
      eventAttendanceType: "virtual",
    });
    expect(errorSlot.textContent).toBe("");
    expect(field.value).toBe("");
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
