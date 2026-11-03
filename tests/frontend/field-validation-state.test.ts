// @vitest-environment jsdom
import { createElement, render } from "preact";
import { ConsentCard } from "../../assets/ts/components/ConsentCard";
import { afterEach, describe, expect, it } from "vitest";
import { installLiveValidation, validateBeforeSubmit } from "../../assets/ts/shared/form/validation";
import { applyFieldErrors, focusFirstInvalidField, setFieldMessage } from "../../assets/ts/shared/form/validation-map";
import { handleSubmitError } from "../../assets/ts/shared/form/submit";
import { ApiClientError } from "../../assets/ts/shared/api-client";

/**
 * The state a server-rendered form shows.
 *
 * These forms are not built by `ui/Field` — a Hugo template ships the markup and
 * a validator moves it between states afterwards. That split is where the
 * feedback used to fall through: the template held every class the design
 * system defines, and nothing ever set a modifier, so no control could show the
 * tick, the caution or the cross.
 */
function buildForm(markup: string): HTMLFormElement {
  const form = document.createElement("form");
  form.noValidate = true;
  form.innerHTML = markup;
  document.body.append(form);
  return form;
}

const emailField = `
  <div class="pk-field">
    <label class="pk-field__label" for="email">Email</label>
    <div class="pk-field__control">
      <input id="email" name="email" type="email" class="pk-input" required />
    </div>
    <p data-field-error="email" class="pk-field__message" aria-live="polite" hidden></p>
  </div>
`;

function field(form: HTMLFormElement): HTMLElement {
  return form.querySelector<HTMLElement>(".pk-field")!;
}

function message(form: HTMLFormElement): HTMLElement {
  return form.querySelector<HTMLElement>('[data-field-error="email"]')!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("validation state on server-rendered fields", () => {
  it("marks a blocked field invalid, with the message shown and a mark drawn", () => {
    const form = buildForm(emailField);
    const status = document.createElement("div");

    expect(validateBeforeSubmit(form, status)).toBe(false);

    expect(field(form).classList.contains("pk-field--invalid")).toBe(true);
    expect(message(form).hidden).toBe(false);
    expect(message(form).textContent).not.toBe("");
    // Color is not a status on its own: the mark has to be there too.
    expect(field(form).querySelector(".pk-field__control .pk-field__state")).not.toBeNull();
    expect(message(form).querySelector(".pk-field__message-icon")).not.toBeNull();
  });

  it("moves a corrected field to the success state and takes the message away", () => {
    const form = buildForm(emailField);
    const status = document.createElement("div");
    const email = form.querySelector<HTMLInputElement>("#email")!;
    installLiveValidation(form, status);

    email.value = "not-an-address";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    expect(field(form).classList.contains("pk-field--invalid")).toBe(true);

    email.value = "ada@example-corp.test";
    email.dispatchEvent(new Event("input", { bubbles: true }));

    expect(field(form).classList.contains("pk-field--invalid")).toBe(false);
    expect(field(form).classList.contains("pk-field--ok")).toBe(true);
    expect(message(form).hidden).toBe(true);
    expect(message(form).textContent).toBe("");
  });

  it("leaves an untouched optional control with no state at all", () => {
    const form = buildForm(`
      <div class="pk-field">
        <label class="pk-field__label" for="org">Organization</label>
        <div class="pk-field__control"><input id="org" name="org" class="pk-input" /></div>
        <p data-field-error="org" class="pk-field__message" hidden></p>
      </div>
    `);
    const status = document.createElement("div");

    expect(validateBeforeSubmit(form, status)).toBe(true);
    // An empty optional field is not a success. Marking every blank control
    // green on load is decoration, not feedback.
    expect(field(form).className).toBe("pk-field");
  });

  it("puts a server field error on the field the message belongs to", () => {
    const form = buildForm(emailField);

    applyFieldErrors(form, { email: "That address is already registered." });

    expect(field(form).classList.contains("pk-field--invalid")).toBe(true);
    expect(message(form).textContent).toBe("That address is already registered.");
    expect(message(form).hidden).toBe(false);

    applyFieldErrors(form, {});
    expect(field(form).classList.contains("pk-field--invalid")).toBe(false);
    expect(message(form).hidden).toBe(true);
  });

  it("takes the reader to the first refused field in reading order, not the submit button", () => {
    const form = buildForm(`
      <div class="pk-field"><div class="pk-field__control"><input name="firstName" required /></div>
        <p data-field-error="firstName" class="pk-field__message" hidden></p></div>
      ${emailField}
      <button type="submit">Submit</button>`);
    const submit = form.querySelector<HTMLButtonElement>("button")!;
    submit.focus();
    expect(validateBeforeSubmit(form, document.createElement("p"))).toBe(false);
    expect(document.activeElement).toBe(form.querySelector('[name="firstName"]'));
  });

  it.each(["alone", "before title", "after title"])(
    "focuses the first refused control before consent errors render: consent %s",
    (position) => {
      const title =
        '<div class="pk-field"><input name="title" required /><p data-field-error="title" hidden></p></div>';
      const consentMarkup = "<div data-consents></div>";
      const fields =
        position === "alone"
          ? consentMarkup
          : position === "before title"
            ? consentMarkup + title
            : title + consentMarkup;
      const form = buildForm(`${fields}<button type="submit">Submit</button>`);
      render(
        createElement(ConsentCard, {
          term: {
            termKey: "code-of-conduct",
            version: "v1",
            required: true,
            contentRef: null,
            displayText: "Code of conduct",
          },
        }),
        form.querySelector("[data-consents]")!,
      );
      const consent = form.querySelector<HTMLInputElement>('[name="consents"]')!;
      form.querySelector<HTMLButtonElement>("button")!.focus();
      expect(form.querySelector(".pk-field--invalid, [aria-invalid='true']")).toBeNull();
      expect(validateBeforeSubmit(form, document.createElement("p"))).toBe(false);
      expect(document.activeElement).toBe(position === "after title" ? form.querySelector('[name="title"]') : consent);
      render(null, form.querySelector("[data-consents]")!);
    },
  );

  it("does not use native constraints to focus a field owned by its contract", () => {
    const form = buildForm(
      '<div data-contract-validation><input name="contract" required /></div><button>Submit</button>',
    );
    const submit = form.querySelector<HTMLButtonElement>("button")!;
    submit.focus();
    validateBeforeSubmit(form, document.createElement("p"));
    expect(document.activeElement).toBe(submit);
  });

  it("focuses the field a server refusal names, or the refusal message when it names none", () => {
    const form = buildForm(`${emailField}<button type="submit">Submit</button>`);
    const status = document.createElement("p");
    status.className = "pk-alert pk-sr-only";
    document.body.append(status);
    handleSubmitError(
      new ApiClientError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Refused",
            details: { fieldErrors: { email: ["Already registered."] } },
          },
        },
        400,
      ),
      form,
      status,
    );
    expect(document.activeElement).toBe(form.querySelector('[name="email"]'));

    handleSubmitError(
      new ApiClientError(
        { error: { code: "DUPLICATE", message: "An application from this address is already in progress." } },
        409,
      ),
      form,
      status,
    );
    expect(document.activeElement).toBe(status);
    expect(status.textContent).toContain("already in progress");
  });

  it("skips a refused field that cannot take focus for the next one", () => {
    const form = buildForm(`
      <div class="pk-field pk-field--invalid" hidden><input name="hiddenField" /></div>
      <div inert><div class="pk-field pk-field--invalid"><input name="inertField" /></div></div>
      <div class="pk-field pk-field--invalid"><input name="disabledField" disabled /></div>
      <div class="pk-field pk-field--invalid"><input name="reachable" /></div>`);
    expect(focusFirstInvalidField(form)).toBe(true);
    expect(document.activeElement).toBe(form.querySelector('[name="reachable"]'));
  });

  it("focuses the refusal message when no refused field can take focus", () => {
    const form = buildForm(`
      <div class="pk-field" hidden><input name="email" />
        <p data-field-error="email" class="pk-field__message" hidden></p></div>
      <button type="submit">Submit</button>`);
    const status = document.createElement("p");
    status.className = "pk-alert pk-sr-only";
    document.body.append(status);
    form.querySelector<HTMLButtonElement>("button")!.focus();
    handleSubmitError(
      new ApiClientError(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Refused",
            details: { fieldErrors: { email: ["Already registered."] } },
          },
        },
        400,
      ),
      form,
      status,
    );
    expect(document.activeElement).toBe(status);
  });

  it("does nothing when the message slot is missing rather than throwing", () => {
    expect(() => setFieldMessage(null, "anything")).not.toThrow();
  });
});
