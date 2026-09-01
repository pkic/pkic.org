// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installLiveValidation, validateBeforeSubmit } from "../../assets/ts/shared/form/validation";
import { applyFieldErrors, setFieldMessage } from "../../assets/ts/shared/form/validation-map";

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
  <p data-email-warning hidden>That looks like a personal address.</p>
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
    // Colour is not a status on its own: the mark has to be there too.
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

  it("reports a personal address as advisory, which does not block the form", () => {
    const form = buildForm(emailField);
    const status = document.createElement("div");
    const email = form.querySelector<HTMLInputElement>("#email")!;
    installLiveValidation(form, status);

    email.value = "ada@gmail.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));

    expect(field(form).classList.contains("pk-field--advisory")).toBe(true);
    expect(field(form).classList.contains("pk-field--invalid")).toBe(false);
    expect(form.querySelector<HTMLElement>("[data-email-warning]")!.hidden).toBe(false);
    // An advisory is not an error, so the form still submits.
    expect(validateBeforeSubmit(form, status)).toBe(true);
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

  it("does nothing when the message slot is missing rather than throwing", () => {
    expect(() => setFieldMessage(null, "anything")).not.toThrow();
  });
});
