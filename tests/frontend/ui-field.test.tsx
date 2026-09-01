// @vitest-environment jsdom
/**
 * The Field's contract with assistive technology.
 *
 * The load-bearing case is the advisory: it warns without blocking, so it must
 * NOT set aria-invalid. Announcing a blocking error for a form that submits
 * fine is worse than saying nothing.
 */

import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Field } from "../../assets/ts/ui/Field";
import { Select, Textarea, TextInput } from "../../assets/ts/ui/TextControl";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

function input(container: HTMLElement): HTMLInputElement {
  const found = container.querySelector("input");
  if (!found) throw new Error("no input rendered");
  return found;
}

describe("Field", () => {
  it("ties the label to the control it labels", () => {
    const container = mount(<Field label="Primary contact">{(c) => <TextInput {...c} />}</Field>);
    const label = container.querySelector("label");
    expect(label?.getAttribute("for")).toBe(input(container).id);
    expect(input(container).id).not.toBe("");
  });

  it("gives each field its own ids so two on one page cannot collide", () => {
    const container = mount(
      <div>
        <Field label="One">{(c) => <TextInput {...c} />}</Field>
        <Field label="Two">{(c) => <TextInput {...c} />}</Field>
      </div>,
    );
    const [first, second] = [...container.querySelectorAll("input")];
    expect(first.id).not.toBe(second.id);
  });

  it("describes the control by its help text when there is no state", () => {
    const container = mount(
      <Field label="Slug" help="Used in the public URL.">
        {(c) => <TextInput {...c} />}
      </Field>,
    );
    const describedBy = input(container).getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(container.querySelector(`#${describedBy}`)?.textContent).toBe("Used in the public URL.");
  });

  it("marks a blocking error invalid and announces it assertively", () => {
    const container = mount(
      <Field label="Deputy" state="invalid" message="Enter a complete email address.">
        {(c) => <TextInput {...c} />}
      </Field>,
    );
    expect(input(container).getAttribute("aria-invalid")).toBe("true");
    const message = container.querySelector(".pk-field__message");
    expect(message?.getAttribute("role")).toBe("alert");
    expect(input(container).getAttribute("aria-describedby")).toBe(message?.id);
  });

  it("does NOT mark an advisory invalid, because it does not block submission", () => {
    const container = mount(
      <Field label="Contact" state="advisory" message="This looks like a personal address.">
        {(c) => <TextInput {...c} />}
      </Field>,
    );
    expect(input(container).getAttribute("aria-invalid")).toBeNull();
    expect(container.querySelector(".pk-field__message")?.getAttribute("role")).toBe("status");
  });

  it("does not mark a satisfied field invalid either", () => {
    const container = mount(
      <Field label="Contact" state="ok" message="Verified against the domain.">
        {(c) => <TextInput {...c} />}
      </Field>,
    );
    expect(input(container).getAttribute("aria-invalid")).toBeNull();
    expect(container.querySelector(".pk-field__message")?.getAttribute("role")).toBe("status");
  });

  it("renders a mark for every state, so the status never depends on colour alone", () => {
    for (const state of ["ok", "advisory", "invalid"] as const) {
      const container = mount(
        <Field label="Contact" state={state} message="Message">
          {(c) => <TextInput {...c} />}
        </Field>,
      );
      expect(container.querySelector(".pk-field__state"), state).not.toBeNull();
      expect(container.querySelector(".pk-field__message-icon"), state).not.toBeNull();
      expect(container.querySelector(".pk-field__state")?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("replaces the help text with the message rather than showing both", () => {
    const container = mount(
      <Field label="Contact" help="Use a work address." state="invalid" message="Enter an address.">
        {(c) => <TextInput {...c} />}
      </Field>,
    );
    expect(container.querySelector(".pk-field__help")).toBeNull();
    expect(container.querySelector(".pk-field__message")?.textContent).toContain("Enter an address.");
  });

  it("keeps the required marker out of the accessible name but announces the word", () => {
    const container = mount(
      <Field label="Group name" required>
        {(c) => <TextInput {...c} />}
      </Field>,
    );
    expect(input(container).required).toBe(true);
    expect(container.querySelector(".pk-field__sr")?.textContent).toBe("(required)");
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
  });

  it("carries the field's props onto a textarea and a select too", () => {
    const withTextarea = mount(<Field label="Charter">{(c) => <Textarea {...c} />}</Field>);
    expect(withTextarea.querySelector("textarea")?.className).toContain("pk-input--textarea");

    const withSelect = mount(
      <Field label="Parent" state="invalid" message="Pick one">
        {(c) => (
          <Select {...c}>
            <option>None</option>
          </Select>
        )}
      </Field>,
    );
    const select = withSelect.querySelector("select");
    expect(select?.className).toContain("pk-input--select");
    expect(select?.getAttribute("aria-invalid")).toBe("true");
  });
});
